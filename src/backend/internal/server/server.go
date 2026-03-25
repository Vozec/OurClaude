package server

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"claude-proxy/internal/config"
	"claude-proxy/internal/crypto"
	"claude-proxy/internal/handlers"
	_ "claude-proxy/internal/metrics" // register Prometheus collectors
	"claude-proxy/internal/middleware"
	"claude-proxy/internal/oauth"
	"claude-proxy/internal/pool"
	"claude-proxy/internal/proxy"
	"claude-proxy/internal/quota"
	"claude-proxy/internal/settings"
	"claude-proxy/internal/sse"
	"claude-proxy/internal/webhook"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"gorm.io/gorm"
)

type Server struct {
	cfg         *config.Config
	db          *gorm.DB
	poolMgr     *pool.Manager
	oauth       *oauth.Refresher
	enc         *crypto.Encryptor
	webhooks    *webhook.Dispatcher
	logStream   *sse.Broadcaster
	statsStream *sse.Broadcaster
	settings    *settings.Service
	frontendFS  fs.FS
}

func New(cfg *config.Config, db *gorm.DB, frontendFS fs.FS) *Server {
	enc := crypto.NewEncryptor(cfg.EncryptionKey)
	oauthRefresher := oauth.New(cfg.OAuthRefreshURL, enc)
	webhooks := webhook.New(db)
	poolMgr := pool.New(db, oauthRefresher, enc, webhooks)

	settingsSvc := settings.New(db)
	settingsSvc.SeedDefaults(map[string]string{
		"system_prompt_inject": cfg.SystemPromptInject,
		"prompt_cache_inject":  fmt.Sprintf("%v", cfg.PromptCacheInject),
		"response_cache_ttl":   fmt.Sprintf("%d", int(cfg.ResponseCacheTTL.Seconds())),
		"user_max_rpm":         fmt.Sprintf("%d", cfg.UserMaxRPM),
		"quota_poll_interval":  "1",
	})

	return &Server{
		cfg:         cfg,
		db:          db,
		poolMgr:     poolMgr,
		oauth:       oauthRefresher,
		enc:         enc,
		webhooks:    webhooks,
		logStream:   sse.New(),
		statsStream: sse.New(),
		settings:    settingsSvc,
		frontendFS:  frontendFS,
	}
}

func (s *Server) SetupAdminRouter() http.Handler {
	r := chi.NewRouter()

	r.Use(chimiddleware.Recoverer)
	r.Use(chimiddleware.RequestID)
	origins := strings.Split(s.cfg.CORSOrigins, ",")
	for i := range origins {
		origins[i] = strings.TrimSpace(origins[i])
	}
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   origins,
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		AllowCredentials: true,
		MaxAge:           300,
	}))
	// Health check + Prometheus metrics (public)
	r.Get("/healthz", s.healthCheck())
	r.Handle("/metrics", promhttp.Handler())

	// API documentation (public)
	r.Get("/docs", handlers.DocsUI)
	r.Get("/docs/openapi.json", handlers.DocsSpec)

	// Auth
	authH := handlers.NewAuthHandler(s.db, s.cfg)
	r.Post("/api/auth/login", authH.Login)
	r.Post("/api/auth/logout", authH.Logout)

	// Public: use an invite
	invitesH := handlers.NewInvitesHandler(s.db)
	r.Post("/api/invite/use", invitesH.Use)

	// Public: setup link (returns user onboarding info without admin auth)
	usersH := handlers.NewUsersHandler(s.db)
	r.Get("/api/setup/{token}", usersH.SetupLinkFetch)

	authMw := middleware.Authenticate(s.cfg)
	r.Group(func(r chi.Router) {
		r.Use(authMw)

		r.Get("/api/auth/me", authH.Me)
		r.Post("/api/auth/totp/setup", authH.TOTPSetup)
		r.Post("/api/auth/totp/enable", authH.TOTPEnable)
		r.Post("/api/auth/totp/disable", authH.TOTPDisable)
		r.Put("/api/auth/password", authH.ChangePassword)

		// Users
		r.Get("/api/admin/users", usersH.List)
		r.Post("/api/admin/users", usersH.Create)
		r.Get("/api/admin/users/{id}", usersH.Get)
		r.Put("/api/admin/users/{id}", usersH.Update)
		r.Delete("/api/admin/users/{id}", usersH.Delete)
		r.Post("/api/admin/users/{id}/rotate-token", usersH.RotateToken)
		r.Post("/api/admin/users/{id}/setup-link", usersH.GenerateSetupLink)
		r.Get("/api/admin/users/{id}/stats", usersH.GetStats)

		// Pools
		poolsH := handlers.NewPoolsHandler(s.db, s.poolMgr)
		r.Get("/api/admin/pools", poolsH.List)
		r.Post("/api/admin/pools", poolsH.Create)
		r.Get("/api/admin/pools/{id}", poolsH.Get)
		r.Put("/api/admin/pools/{id}", poolsH.Update)
		r.Delete("/api/admin/pools/{id}", poolsH.Delete)
		r.Post("/api/admin/pools/{id}/reset", poolsH.Reset)
		r.Get("/api/admin/pools/{id}/stats", poolsH.Stats)
		r.Get("/api/admin/pools/{id}/users", poolsH.Users)
		r.Get("/api/admin/pools/{id}/quotas", poolsH.Quotas)

		// Teams
		teamsH := handlers.NewTeamsHandler(s.db)
		r.Get("/api/admin/teams", teamsH.List)
		r.Post("/api/admin/teams", teamsH.Create)
		r.Put("/api/admin/teams/{id}", teamsH.Update)
		r.Delete("/api/admin/teams/{id}", teamsH.Delete)

		// Accounts
		accountsH := handlers.NewAccountsHandler(s.db, s.enc, s.oauth, s.poolMgr, s.cfg)
		r.Get("/api/admin/accounts", accountsH.List)
		r.Post("/api/admin/accounts", accountsH.Create)
		r.Get("/api/admin/accounts/{id}", accountsH.Get)
		r.Put("/api/admin/accounts/{id}", accountsH.Update)
		r.Delete("/api/admin/accounts/{id}", accountsH.Delete)
		r.Post("/api/admin/accounts/{id}/refresh", accountsH.Refresh)
		r.Post("/api/admin/accounts/{id}/reset", accountsH.Reset)
		r.Post("/api/admin/accounts/{id}/test", accountsH.Test)
		r.Post("/api/admin/accounts/{id}/toggle", accountsH.ToggleStatus)
		r.Get("/api/admin/accounts/{id}/stats", accountsH.Stats)
		r.Get("/api/admin/accounts/{id}/credentials", accountsH.Credentials)
		r.Delete("/api/admin/accounts/{id}/pool", accountsH.Unlink)
		r.Get("/api/admin/accounts/{id}/quota", accountsH.Quota)
		r.Get("/api/admin/quotas", accountsH.AllQuotas)

		// Stats
		statsH := handlers.NewStatsHandler(s.db)
		r.Get("/api/admin/stats/overview", statsH.Overview)
		r.Get("/api/admin/stats/usage", statsH.Usage)
		r.Get("/api/admin/stats/by-user", statsH.ByUser)
		r.Get("/api/admin/stats/by-day", statsH.ByDay)
		r.Get("/api/admin/stats/by-model", statsH.ByModel)
		r.Get("/api/admin/stats/export", statsH.ExportCSV)

		// Admins (multiple admin accounts)
		adminsH := handlers.NewAdminsHandler(s.db, s.cfg)
		r.Get("/api/admin/admins", adminsH.List)
		r.Post("/api/admin/admins", adminsH.Create)
		r.Put("/api/admin/admins/{id}", adminsH.Update)
		r.Delete("/api/admin/admins/{id}", adminsH.Delete)
		r.Post("/api/admin/admins/{id}/generate-session", adminsH.GenerateSession)

		// Webhooks
		webhooksH := handlers.NewWebhooksHandler(s.db)
		r.Get("/api/admin/webhooks", webhooksH.List)
		r.Post("/api/admin/webhooks", webhooksH.Create)
		r.Put("/api/admin/webhooks/{id}", webhooksH.Update)
		r.Delete("/api/admin/webhooks/{id}", webhooksH.Delete)
		r.Post("/api/admin/webhooks/{id}/test", webhooksH.Test)

		// Invites
		r.Get("/api/admin/invites", invitesH.List)
		r.Post("/api/admin/invites", invitesH.Create)
		r.Delete("/api/admin/invites/{id}", invitesH.Delete)

		// Audit log
		auditH := handlers.NewAuditHandler(s.db)
		r.Get("/api/admin/audit", auditH.List)

		// Conversation logs
		convsH := handlers.NewConversationsHandler(s.db)
		r.Get("/api/admin/conversations", convsH.List)
		r.Get("/api/admin/conversations/export", convsH.Export)
		r.Get("/api/admin/conversations/{id}", convsH.Get)
		r.Get("/api/admin/conversations/{id}/export", convsH.ExportOne)

		// Model aliases
		aliasesH := handlers.NewAliasesHandler(s.db)
		r.Get("/api/admin/model-aliases", aliasesH.List)
		r.Post("/api/admin/model-aliases", aliasesH.Create)
		r.Delete("/api/admin/model-aliases/{id}", aliasesH.Delete)

		// Admin sessions
		sessionsH := handlers.NewSessionsHandler(s.db)
		r.Get("/api/admin/sessions", sessionsH.List)
		r.Delete("/api/admin/sessions/{id}", sessionsH.Revoke)

		// Runtime settings
		settingsH := handlers.NewSettingsHandler(s.settings)
		r.Get("/api/admin/settings", settingsH.List)
		r.Put("/api/admin/settings", settingsH.Update)

		// Stats: latency + new endpoints
		r.Get("/api/admin/stats/latency", statsH.Latency)
		r.Get("/api/admin/stats/by-model-day", statsH.ByModelDay)
		r.Get("/api/admin/stats/heatmap", statsH.Heatmap)
		r.Get("/api/admin/stats/sessions", statsH.Sessions)

		// Log stream (SSE)
		logStreamH := handlers.NewLogStreamHandler(s.logStream)
		r.Get("/api/admin/logs/stream", logStreamH.Stream)

		// Stats stream (SSE)
		r.Get("/api/admin/stats/stream", handlers.NewLogStreamHandler(s.statsStream).Stream)

		// MCP servers (admin)
		mcpH := handlers.NewMCPHandler(s.db)
		r.Get("/api/admin/mcp-servers", mcpH.List)
		r.Post("/api/admin/mcp-servers", mcpH.Create)
		r.Put("/api/admin/mcp-servers/{id}", mcpH.Update)
		r.Delete("/api/admin/mcp-servers/{id}", mcpH.Delete)

		// Downloads (admin: list platforms + direct download + link management)
		downloadsH := handlers.NewDownloadsHandler(s.db, s.cfg.DistDir)
		r.Get("/api/downloads", downloadsH.ListPlatforms)
		r.Get("/api/downloads/{platform}", downloadsH.AuthDownload)
		r.Get("/api/admin/download-links", downloadsH.ListLinks)
		r.Post("/api/admin/download-links", downloadsH.CreateLink)
		r.Post("/api/admin/download-links/{id}/revoke", downloadsH.RevokeLink)
		r.Delete("/api/admin/download-links/{id}", downloadsH.DeleteLink)
		r.Get("/api/admin/binary-downloads", downloadsH.ListBinaryDownloads)
	})

	// Public: pre-auth download link
	downloadsH := handlers.NewDownloadsHandler(s.db, s.cfg.DistDir)
	r.Get("/dl/{token}", downloadsH.PreAuthDownload)

	// Install script (public)
	installH := handlers.NewInstallHandler(s.db)
	r.Get("/api/install/{token}", installH.Script)

	// User self-service (authenticated with sk-proxy-* token, not admin JWT)
	userSelfH := handlers.NewUserSelfHandler(s.db, s.cfg.DistDir, s.enc)
	r.Get("/api/user/me", userSelfH.Me)
	r.Get("/api/user/usage", userSelfH.Usage)
	r.Post("/api/user/rotate-token", userSelfH.RotateToken)
	r.Get("/api/user/update", userSelfH.Update)
	r.Post("/api/user/import-account", userSelfH.ImportAccount)
	r.Get("/api/user/owned-account", userSelfH.OwnedAccount)
	r.Get("/api/user/pool-status", userSelfH.PoolStatus)
	r.Get("/api/user/mcp-servers", userSelfH.MCPServers)

	// Anthropic proxy mounted at /proxy — ANTHROPIC_BASE_URL=http://server:3000/proxy
	proxyH := proxy.New(s.db, s.poolMgr, s.cfg.AnthropicURL, s.cfg.RedisURL, s.settings, s.webhooks, s.logStream, s.statsStream)
	r.Mount("/proxy", proxyH)

	r.Get("/*", s.frontendHandler())

	return r
}

func (s *Server) healthCheck() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Check DB
		sqlDB, err := s.db.DB()
		if err != nil || sqlDB.Ping() != nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusServiceUnavailable)
			json.NewEncoder(w).Encode(map[string]string{"status": "unhealthy", "reason": "db unavailable"})
			return
		}

		// Count active accounts
		var activeAccounts int64
		s.db.Model(nil).Table("claude_accounts").Where("status = ?", "active").Count(&activeAccounts)

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":          "ok",
			"active_accounts": activeAccounts,
		})
	}
}

func (s *Server) frontendHandler() http.HandlerFunc {
	if s.frontendFS == nil {
		return func(w http.ResponseWriter, r *http.Request) {
			http.Error(w, "frontend not available", http.StatusNotFound)
		}
	}

	fileServer := http.FileServer(http.FS(s.frontendFS))

	return func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if path == "/" {
			path = "index.html"
		} else {
			path = path[1:]
		}

		_, err := s.frontendFS.Open(path)
		if err == nil {
			fileServer.ServeHTTP(w, r)
			return
		}

		// SPA fallback
		index, err := fs.ReadFile(s.frontendFS, "index.html")
		if err != nil {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(index)
	}
}


func (s *Server) Start() error {
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	s.poolMgr.StartAutoReset(ctx, s.cfg.PoolResetInterval)
	s.poolMgr.StartHealthCheck(ctx, s.cfg.HealthCheckInterval, s.cfg.AnthropicURL)

	// Start Anthropic quota poller
	quotaPoller := quota.New(s.db, s.enc, s.settings)
	quotaPoller.Start(ctx)

	router := s.SetupAdminRouter()

	if chiRouter, ok := router.(chi.Router); ok {
		handlers.SetOpenAPISpec(handlers.GenerateOpenAPISpec(chiRouter))
	}

	addr := fmt.Sprintf("0.0.0.0:%s", s.cfg.WebPort)
	server := &http.Server{
		Addr:         addr,
		Handler:      router,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 5 * time.Minute, // Long for streaming responses
		IdleTimeout:  120 * time.Second,
	}

	go func() {
		<-ctx.Done()
		log.Println("shutting down gracefully...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		server.Shutdown(shutdownCtx)
	}()

	log.Printf("OurClaude listening on http://%s  (proxy at /proxy)", addr)
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		return fmt.Errorf("server: %w", err)
	}
	return nil
}
