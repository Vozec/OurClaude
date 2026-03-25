package handlers

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"claude-proxy/internal/database"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

type InstallHandler struct {
	db *gorm.DB
}

func NewInstallHandler(db *gorm.DB) *InstallHandler {
	return &InstallHandler{db: db}
}

// GET /api/install/{token} — returns a bash install script with embedded credentials
func (h *InstallHandler) Script(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")

	// Try setup token first
	var setup database.SetupToken
	if err := h.db.Where("token = ? AND expires_at > ?", token, time.Now()).First(&setup).Error; err != nil {
		http.Error(w, "invalid or expired token", http.StatusNotFound)
		return
	}

	var user database.User
	if err := h.db.First(&user, setup.UserID).Error; err != nil {
		http.Error(w, "user not found", http.StatusNotFound)
		return
	}

	// Get server URL from request
	scheme := "https"
	if r.TLS == nil {
		scheme = "http"
	}
	if fwd := r.Header.Get("X-Forwarded-Proto"); fwd != "" {
		scheme = fwd
	}
	serverURL := fmt.Sprintf("%s://%s", scheme, r.Host)

	// Generate download links for all platforms
	dlLinks := CreateLinksForUser(h.db, user.ID, 3)

	script := generateInstallScript(serverURL, user.APIToken, dlLinks)

	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Write([]byte(script))
}

func generateInstallScript(serverURL, apiToken string, dlLinks map[string]string) string {
	var sb strings.Builder
	sb.WriteString("#!/bin/bash\n")
	sb.WriteString("set -euo pipefail\n\n")
	sb.WriteString("# OurClaude automatic installer\n")
	sb.WriteString(fmt.Sprintf("SERVER=%q\n", serverURL))
	sb.WriteString(fmt.Sprintf("TOKEN=%q\n\n", apiToken))

	sb.WriteString("OS=$(uname -s | tr '[:upper:]' '[:lower:]')\n")
	sb.WriteString("ARCH=$(uname -m)\n")
	sb.WriteString("case \"$ARCH\" in\n")
	sb.WriteString("    x86_64)        ARCH=\"amd64\" ;;\n")
	sb.WriteString("    aarch64|arm64) ARCH=\"arm64\" ;;\n")
	sb.WriteString("esac\n")
	sb.WriteString("PLATFORM=\"${OS}-${ARCH}\"\n\n")

	sb.WriteString("echo \"Installing ourclaude for ${PLATFORM}...\"\n\n")

	sb.WriteString("case \"$PLATFORM\" in\n")
	for platform, dlPath := range dlLinks {
		sb.WriteString(fmt.Sprintf("    %s)\n", platform))
		sb.WriteString(fmt.Sprintf("        curl -fsSL \"%s%s\" -o /usr/local/bin/ourclaude\n", serverURL, dlPath))
		sb.WriteString("        ;;\n")
	}
	sb.WriteString("    *)\n")
	sb.WriteString("        echo \"Unsupported platform: ${PLATFORM}\"\n")
	sb.WriteString("        exit 1\n")
	sb.WriteString("        ;;\n")
	sb.WriteString("esac\n\n")

	sb.WriteString("chmod +x /usr/local/bin/ourclaude\n")
	sb.WriteString("echo \"Binary installed to /usr/local/bin/ourclaude\"\n\n")

	sb.WriteString("# Install RTK (token optimizer — reduces Claude Code token usage by 60-90%)\n")
	sb.WriteString("echo \"Installing RTK token optimizer...\"\n")
	sb.WriteString("if command -v rtk &>/dev/null; then\n")
	sb.WriteString("    echo \"RTK already installed, skipping.\"\n")
	sb.WriteString("else\n")
	sb.WriteString("    curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | bash && \\\n")
	sb.WriteString("        mv \"$HOME/.local/bin/rtk\" /usr/local/bin/rtk 2>/dev/null || true\n")
	sb.WriteString("    if command -v rtk &>/dev/null; then\n")
	sb.WriteString("        rtk init --global 2>/dev/null || true\n")
	sb.WriteString("        echo \"RTK installed and configured.\"\n")
	sb.WriteString("    else\n")
	sb.WriteString("        echo \"RTK installation failed (optional, continuing).\"\n")
	sb.WriteString("    fi\n")
	sb.WriteString("fi\n\n")

	sb.WriteString("# Auto-login\n")
	sb.WriteString("ourclaude login \"$SERVER\" \"$TOKEN\"\n")
	sb.WriteString("echo \"\"\n")
	sb.WriteString("echo \"Done! Run 'ourclaude' to start using Claude.\"\n")

	return sb.String()
}
