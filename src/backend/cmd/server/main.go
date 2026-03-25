package main

import (
	"io/fs"
	"log"

	"claude-proxy/internal/config"
	"claude-proxy/internal/database"
	"claude-proxy/internal/server"

	"golang.org/x/crypto/bcrypt"
)

func main() {
	cfg := config.Load()

	log.Printf("Claude Proxy starting...")
	log.Printf("  Web UI  → http://0.0.0.0:%s", cfg.WebPort)
	log.Printf("  Proxy   → http://0.0.0.0:%s", cfg.ProxyPort)
	log.Printf("  DB      → %s (%s)", cfg.DBPath, cfg.DBType)

	db, err := database.New(cfg.DBType, cfg.DBPath, cfg.PostgresDSN)
	if err != nil {
		log.Fatalf("failed to open database: %v", err)
	}

	// Create default admin if none exists
	var adminCount int64
	db.Model(&database.Admin{}).Count(&adminCount)
	if adminCount == 0 {
		if cfg.AdminPassword == "" {
			log.Fatal("ADMIN_PASSWORD env var is required on first run (no admin exists yet)")
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(cfg.AdminPassword), bcrypt.DefaultCost)
		if err != nil {
			log.Fatalf("failed to hash admin password: %v", err)
		}
		if err := db.Create(&database.Admin{
			Username:     cfg.AdminUsername,
			PasswordHash: string(hash),
			Role:         "super_admin",
		}).Error; err != nil {
			log.Fatalf("failed to create default admin: %v", err)
		}
		log.Printf("Created admin user: %s (super_admin)", cfg.AdminUsername)
	}

	// Sub into embedded frontend dist (nil if not built with -tags prod)
	frontendFS, err := fs.Sub(embeddedFrontend, "frontend/dist")
	if err != nil {
		log.Printf("Warning: no embedded frontend - UI unavailable (build with -tags prod)")
		frontendFS = nil
	}

	srv := server.New(cfg, db, frontendFS)
	if err := srv.Start(); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
