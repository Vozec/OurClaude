package handlers

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"claude-proxy/internal/crypto"
	"claude-proxy/internal/database"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

var errInvalidToken = errors.New("invalid token")

// UserSelfHandler serves /api/user/* — authenticated with the sk-proxy-* token,
// not the admin JWT. Allows users to check their own info and usage.
type UserSelfHandler struct {
	db      *gorm.DB
	distDir string
	enc     *crypto.Encryptor
}

func NewUserSelfHandler(db *gorm.DB, distDir string, enc *crypto.Encryptor) *UserSelfHandler {
	return &UserSelfHandler{db: db, distDir: distDir, enc: enc}
}

func (h *UserSelfHandler) extractUser(r *http.Request) (*database.User, error) {
	auth := r.Header.Get("Authorization")
	if auth == "" {
		return nil, errInvalidToken
	}
	token := strings.TrimPrefix(auth, "Bearer ")
	if token == auth {
		return nil, errInvalidToken
	}

	var user database.User
	if err := h.db.Preload("Pool").Where("api_token = ? AND active = ?", token, true).First(&user).Error; err != nil {
		return nil, errInvalidToken
	}
	return &user, nil
}

// GET /api/user/me — returns user info with quota usage (no token exposed)
func (h *UserSelfHandler) Me(w http.ResponseWriter, r *http.Request) {
	user, err := h.extractUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errResp("invalid token"))
		return
	}

	now := time.Now().UTC()
	today := now.Truncate(24 * time.Hour)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

	var dailyUsed, monthlyUsed int64
	h.db.Model(&database.UsageLog{}).
		Where("user_id = ? AND created_at >= ?", user.ID, today).
		Select("COALESCE(SUM(input_tokens + output_tokens), 0)").
		Row().Scan(&dailyUsed)
	h.db.Model(&database.UsageLog{}).
		Where("user_id = ? AND created_at >= ?", user.ID, monthStart).
		Select("COALESCE(SUM(input_tokens + output_tokens), 0)").
		Row().Scan(&monthlyUsed)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":         user.ID,
		"name":       user.Name,
		"pool":       user.Pool,
		"active":     user.Active,
		"created_at": user.CreatedAt,
		"quota": map[string]interface{}{
			"daily_used":     dailyUsed,
			"daily_limit":    user.DailyTokenQuota,
			"monthly_used":   monthlyUsed,
			"monthly_limit":  user.MonthlyTokenQuota,
			"monthly_budget": user.MonthlyBudgetUSD,
		},
	})
}

// GET /api/user/usage — returns this user's usage stats
func (h *UserSelfHandler) Usage(w http.ResponseWriter, r *http.Request) {
	user, err := h.extractUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errResp("invalid token"))
		return
	}

	var totalReqs int64
	var totalIn, totalOut int64
	h.db.Model(&database.UsageLog{}).Where("user_id = ?", user.ID).Count(&totalReqs)
	h.db.Model(&database.UsageLog{}).
		Where("user_id = ?", user.ID).
		Select("COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0)").
		Row().Scan(&totalIn, &totalOut)

	type dayStat struct {
		Day          string `json:"day"`
		TotalReqs    int64  `json:"total_requests"`
		InputTokens  int64  `json:"input_tokens"`
		OutputTokens int64  `json:"output_tokens"`
	}
	var byDay []dayStat
	h.db.Model(&database.UsageLog{}).
		Where("user_id = ? AND created_at >= ?", user.ID, time.Now().AddDate(0, 0, -7)).
		Select("DATE(created_at) as day, count(*) as total_reqs, COALESCE(SUM(input_tokens),0) as input_tokens, COALESCE(SUM(output_tokens),0) as output_tokens").
		Group("DATE(created_at)").
		Order("day ASC").
		Scan(&byDay)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total_requests": totalReqs,
		"total_input":    totalIn,
		"total_output":   totalOut,
		"last_7_days":    byDay,
	})
}

// GET /api/user/update?platform=linux-amd64 — download latest cl binary with embedded key
func (h *UserSelfHandler) Update(w http.ResponseWriter, r *http.Request) {
	user, err := h.extractUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errResp("invalid token"))
		return
	}

	platform := r.URL.Query().Get("platform")
	if platform == "" {
		writeJSON(w, http.StatusBadRequest, errResp("platform query parameter required (e.g. linux-amd64)"))
		return
	}

	platformFiles := map[string]string{
		"linux-amd64":   "ourclaude-linux-amd64",
		"linux-arm64":   "ourclaude-linux-arm64",
		"darwin-amd64":  "ourclaude-darwin-amd64",
		"darwin-arm64":  "ourclaude-darwin-arm64",
		"windows-amd64": "ourclaude-windows-amd64.exe",
	}
	filename, ok := platformFiles[platform]
	if !ok {
		writeJSON(w, http.StatusBadRequest, errResp("unknown platform"))
		return
	}

	path := filepath.Join(h.distDir, filename)
	data, err := os.ReadFile(path)
	if err != nil {
		writeJSON(w, http.StatusNotFound, errResp("binary not available for this platform"))
		return
	}

	key := strings.ReplaceAll(uuid.New().String(), "-", "")
	patched := patchBinaryToken(data, key)

	// Record the download.
	h.db.Create(&database.UserBinaryDownload{
		UserID:       user.ID,
		Platform:     platform,
		BinaryKey:    key,
		DownloadedAt: time.Now(),
	})

	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(patched)))
	w.Write(patched)
}

// POST /api/user/rotate-token — rotate own API token
func (h *UserSelfHandler) RotateToken(w http.ResponseWriter, r *http.Request) {
	user, err := h.extractUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errResp("invalid token"))
		return
	}

	newToken := "sk-proxy-" + strings.ReplaceAll(uuid.New().String(), "-", "")
	if err := h.db.Model(&database.User{}).Where("id = ?", user.ID).
		Update("api_token", newToken).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to rotate token"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"api_token": newToken})
}

// POST /api/user/import-account
// Imports ~/.claude/.credentials.json content into the proxy as a ClaudeAccount
// owned by this user. If an owned account already exists, it is updated.
func (h *UserSelfHandler) ImportAccount(w http.ResponseWriter, r *http.Request) {
	if h.enc == nil {
		writeJSON(w, http.StatusInternalServerError, errResp("encryption not configured"))
		return
	}

	user, err := h.extractUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errResp("invalid token"))
		return
	}

	var req struct {
		CredentialsJSON string `json:"credentials_json"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.CredentialsJSON == "" {
		writeJSON(w, http.StatusBadRequest, errResp("credentials_json is required"))
		return
	}

	// Parse the Claude credentials format
	var creds struct {
		ClaudeAiOauth struct {
			AccessToken  string `json:"accessToken"`
			RefreshToken string `json:"refreshToken"`
			ExpiresAt    int64  `json:"expiresAt"` // milliseconds
		} `json:"claudeAiOauth"`
	}
	if err := json.Unmarshal([]byte(req.CredentialsJSON), &creds); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid credentials JSON format"))
		return
	}
	if creds.ClaudeAiOauth.AccessToken == "" || creds.ClaudeAiOauth.RefreshToken == "" {
		writeJSON(w, http.StatusBadRequest, errResp("credentials must contain claudeAiOauth.accessToken and refreshToken"))
		return
	}

	// Resolve pool: prefer user's assigned pool, fall back to any available pool
	var poolID uint
	var poolEntry database.UserPool
	if err := h.db.Where("user_id = ?", user.ID).First(&poolEntry).Error; err == nil {
		poolID = poolEntry.PoolID
	} else if user.PoolID != nil {
		poolID = *user.PoolID
	} else {
		// No pool assigned to this user — use the first available pool
		var anyPool database.Pool
		if err := h.db.First(&anyPool).Error; err != nil {
			writeJSON(w, http.StatusBadRequest, errResp("no pools exist in the proxy yet — ask an administrator to create one"))
			return
		}
		poolID = anyPool.ID
	}

	var expiresAt time.Time
	if creds.ClaudeAiOauth.ExpiresAt > 0 {
		expiresAt = time.UnixMilli(creds.ClaudeAiOauth.ExpiresAt)
	} else {
		expiresAt = time.Now().Add(1 * time.Hour)
	}

	encAccess, err := h.enc.Encrypt(creds.ClaudeAiOauth.AccessToken)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to encrypt access token"))
		return
	}
	encRefresh, err := h.enc.Encrypt(creds.ClaudeAiOauth.RefreshToken)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to encrypt refresh token"))
		return
	}

	// Upsert: update if owned account exists, create otherwise
	var existing database.ClaudeAccount
	if err := h.db.Where("owner_user_id = ?", user.ID).First(&existing).Error; err == nil {
		// Update existing
		h.db.Model(&existing).Updates(map[string]interface{}{
			"access_token":  encAccess,
			"refresh_token": encRefresh,
			"expires_at":    expiresAt,
			"status":        "active",
			"last_error":    "",
		})
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"message":    "account updated",
			"account_id": existing.ID,
		})
		return
	}

	account := database.ClaudeAccount{
		PoolID:       poolID,
		Name:         user.Name + " (personal)",
		AccessToken:  encAccess,
		RefreshToken: encRefresh,
		ExpiresAt:    expiresAt,
		Status:       "active",
		OwnerUserID:  &user.ID,
	}
	if err := h.db.Create(&account).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to create account"))
		return
	}

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"message":    "account imported",
		"account_id": account.ID,
	})
}

// GET /api/user/pool-status — returns pools account summary + today/week usage for the CLI dashboard
func (h *UserSelfHandler) PoolStatus(w http.ResponseWriter, r *http.Request) {
	user, err := h.extractUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errResp("invalid token"))
		return
	}

	// Resolve pool IDs from join table, fallback to legacy pool_id
	var poolIDs []uint
	h.db.Table("user_pools").Where("user_id = ?", user.ID).Pluck("pool_id", &poolIDs)
	if len(poolIDs) == 0 && user.PoolID != nil {
		poolIDs = []uint{*user.PoolID}
	}

	type accountCounts struct {
		Active    int64 `json:"active"`
		Exhausted int64 `json:"exhausted"`
		Error     int64 `json:"error"`
	}
	type poolEntry struct {
		ID       uint          `json:"id"`
		Name     string        `json:"name"`
		Accounts accountCounts `json:"accounts"`
	}

	poolEntries := make([]poolEntry, 0)
	for _, pid := range poolIDs {
		var p database.Pool
		if err := h.db.First(&p, pid).Error; err != nil {
			continue
		}
		var active, exhausted, errCount int64
		h.db.Model(&database.ClaudeAccount{}).Where("pool_id = ? AND status = ?", pid, "active").Count(&active)
		h.db.Model(&database.ClaudeAccount{}).Where("pool_id = ? AND status = ?", pid, "exhausted").Count(&exhausted)
		h.db.Model(&database.ClaudeAccount{}).Where("pool_id = ? AND status = ?", pid, "error").Count(&errCount)
		poolEntries = append(poolEntries, poolEntry{
			ID:   p.ID,
			Name: p.Name,
			Accounts: accountCounts{
				Active:    active,
				Exhausted: exhausted,
				Error:     errCount,
			},
		})
	}

	now := time.Now().UTC()
	today := now.Truncate(24 * time.Hour)
	weekStart := today.AddDate(0, 0, -7)

	type periodStats struct {
		Requests     int64 `json:"requests"`
		InputTokens  int64 `json:"input_tokens"`
		OutputTokens int64 `json:"output_tokens"`
	}

	var todayStats, weekStats periodStats
	h.db.Model(&database.UsageLog{}).
		Where("user_id = ? AND created_at >= ?", user.ID, today).
		Count(&todayStats.Requests)
	h.db.Model(&database.UsageLog{}).
		Where("user_id = ? AND created_at >= ?", user.ID, today).
		Select("COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0)").
		Row().Scan(&todayStats.InputTokens, &todayStats.OutputTokens)

	h.db.Model(&database.UsageLog{}).
		Where("user_id = ? AND created_at >= ?", user.ID, weekStart).
		Count(&weekStats.Requests)
	h.db.Model(&database.UsageLog{}).
		Where("user_id = ? AND created_at >= ?", user.ID, weekStart).
		Select("COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0)").
		Row().Scan(&weekStats.InputTokens, &weekStats.OutputTokens)

	// Owned account metadata + its own today/week usage stats
	type ownedAccountInfo struct {
		ID        uint        `json:"id"`
		Status    string      `json:"status"`
		ExpiresAt time.Time   `json:"expires_at"`
		LastError string      `json:"last_error,omitempty"`
		Today     periodStats `json:"today"`
		Week      periodStats `json:"week"`
	}
	var owned *ownedAccountInfo
	var account database.ClaudeAccount
	if h.db.Where("owner_user_id = ?", user.ID).First(&account).Error == nil {
		var accToday, accWeek periodStats
		h.db.Model(&database.UsageLog{}).
			Where("account_id = ? AND created_at >= ?", account.ID, today).
			Count(&accToday.Requests)
		h.db.Model(&database.UsageLog{}).
			Where("account_id = ? AND created_at >= ?", account.ID, today).
			Select("COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0)").
			Row().Scan(&accToday.InputTokens, &accToday.OutputTokens)

		h.db.Model(&database.UsageLog{}).
			Where("account_id = ? AND created_at >= ?", account.ID, weekStart).
			Count(&accWeek.Requests)
		h.db.Model(&database.UsageLog{}).
			Where("account_id = ? AND created_at >= ?", account.ID, weekStart).
			Select("COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0)").
			Row().Scan(&accWeek.InputTokens, &accWeek.OutputTokens)

		owned = &ownedAccountInfo{
			ID:        account.ID,
			Status:    account.Status,
			ExpiresAt: account.ExpiresAt,
			LastError: account.LastError,
			Today:     accToday,
			Week:      accWeek,
		}
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"pools":         poolEntries,
		"today":         todayStats,
		"week":          weekStats,
		"owned_account": owned,
	})
}

// GET /api/user/owned-account
// Returns the current decrypted credentials for the account this user owns,
// in the ~/.claude/.credentials.json format. Used by cl to keep local credentials in sync.
func (h *UserSelfHandler) OwnedAccount(w http.ResponseWriter, r *http.Request) {
	if h.enc == nil {
		writeJSON(w, http.StatusInternalServerError, errResp("encryption not configured"))
		return
	}

	user, err := h.extractUser(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errResp("invalid token"))
		return
	}

	var account database.ClaudeAccount
	if err := h.db.Where("owner_user_id = ?", user.ID).First(&account).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("no owned account"))
		return
	}

	access, err := h.enc.Decrypt(account.AccessToken)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to decrypt token"))
		return
	}
	refresh, err := h.enc.Decrypt(account.RefreshToken)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to decrypt token"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"claudeAiOauth": map[string]interface{}{
			"accessToken":  access,
			"refreshToken": refresh,
			"expiresAt":    account.ExpiresAt.UnixMilli(),
		},
	})
}
