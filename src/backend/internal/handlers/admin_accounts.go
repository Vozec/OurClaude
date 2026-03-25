package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"claude-proxy/internal/config"
	"claude-proxy/internal/crypto"
	"claude-proxy/internal/database"
	"claude-proxy/internal/oauth"
	"claude-proxy/internal/pool"

	"gorm.io/gorm"
)

type AccountsHandler struct {
	db      *gorm.DB
	enc     *crypto.Encryptor
	oauth   *oauth.Refresher
	poolMgr *pool.Manager
	cfg     *config.Config
}

func NewAccountsHandler(db *gorm.DB, enc *crypto.Encryptor, oauthRefresher *oauth.Refresher, poolMgr *pool.Manager, cfg *config.Config) *AccountsHandler {
	return &AccountsHandler{db: db, enc: enc, oauth: oauthRefresher, poolMgr: poolMgr, cfg: cfg}
}

func (h *AccountsHandler) List(w http.ResponseWriter, r *http.Request) {
	var accounts []database.ClaudeAccount
	if err := h.db.Preload("Pools").Find(&accounts).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to fetch accounts"))
		return
	}
	writeJSON(w, http.StatusOK, accounts)
}

type credentialsJSON struct {
	ClaudeAiOauth struct {
		AccessToken  string `json:"accessToken"`
		RefreshToken string `json:"refreshToken"`
		ExpiresAt    int64  `json:"expiresAt"` // milliseconds
	} `json:"claudeAiOauth"`
}

func (h *AccountsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name            string `json:"name"`
		PoolID          *uint  `json:"pool_id"`  // legacy single pool
		PoolIDs         []uint `json:"pool_ids"` // multi-pool
		CredentialsJSON string `json:"credentials_json"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	if req.Name == "" || req.CredentialsJSON == "" {
		writeJSON(w, http.StatusBadRequest, errResp("name and credentials_json are required"))
		return
	}

	// Parse credentials
	var creds credentialsJSON
	if err := json.Unmarshal([]byte(req.CredentialsJSON), &creds); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid credentials JSON format"))
		return
	}

	if creds.ClaudeAiOauth.AccessToken == "" || creds.ClaudeAiOauth.RefreshToken == "" {
		writeJSON(w, http.StatusBadRequest, errResp("credentials must contain claudeAiOauth.accessToken and claudeAiOauth.refreshToken"))
		return
	}

	var expiresAt time.Time
	if creds.ClaudeAiOauth.ExpiresAt > 0 {
		expiresAt = time.UnixMilli(creds.ClaudeAiOauth.ExpiresAt)
	} else {
		expiresAt = time.Now().Add(1 * time.Hour)
	}

	// Encrypt tokens
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

	// Merge pool_id into pool_ids for backward compat
	poolIDs := req.PoolIDs
	if len(poolIDs) == 0 && req.PoolID != nil && *req.PoolID != 0 {
		poolIDs = []uint{*req.PoolID}
	}

	account := database.ClaudeAccount{
		Name:         req.Name,
		AccessToken:  encAccess,
		RefreshToken: encRefresh,
		ExpiresAt:    expiresAt,
		Status:       "active",
	}

	if err := h.db.Create(&account).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to create account"))
		return
	}

	// Create join table entries
	for _, pid := range poolIDs {
		h.db.Create(&database.AccountPool{AccountID: account.ID, PoolID: pid})
	}

	h.db.Preload("Pools").First(&account, account.ID)
	writeJSON(w, http.StatusCreated, account)
}

func (h *AccountsHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var account database.ClaudeAccount
	if err := h.db.Preload("Pools").First(&account, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("account not found"))
		return
	}
	writeJSON(w, http.StatusOK, account)
}

func (h *AccountsHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var req struct {
		Name    string  `json:"name"`
		PoolID  *uint   `json:"pool_id"`  // legacy
		PoolIDs *[]uint `json:"pool_ids"` // multi-pool
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}

	if len(updates) > 0 {
		if err := h.db.Model(&database.ClaudeAccount{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp("failed to update account"))
			return
		}
	}

	// Sync pool assignments if provided
	poolIDs := req.PoolIDs
	if poolIDs == nil && req.PoolID != nil {
		ids := []uint{*req.PoolID}
		poolIDs = &ids
	}
	if poolIDs != nil {
		// Delete existing links and re-create
		h.db.Where("account_id = ?", id).Delete(&database.AccountPool{})
		for _, pid := range *poolIDs {
			if pid != 0 {
				h.db.Create(&database.AccountPool{AccountID: uint(id), PoolID: pid})
			}
		}
	}

	var account database.ClaudeAccount
	h.db.Preload("Pools").First(&account, id)
	writeJSON(w, http.StatusOK, account)
}

func (h *AccountsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	if err := h.db.Delete(&database.ClaudeAccount{}, id).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to delete account"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "account deleted"})
}

func (h *AccountsHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var account database.ClaudeAccount
	if err := h.db.First(&account, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("account not found"))
		return
	}

	// Decrypt before passing to oauth refresher
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
	account.AccessToken = access
	account.RefreshToken = refresh

	if err := h.oauth.RefreshToken(h.db, &account); err != nil {
		writeJSON(w, http.StatusBadGateway, errResp("token refresh failed: "+err.Error()))
		return
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message":    "token refreshed",
		"expires_at": account.ExpiresAt,
	})
}

func (h *AccountsHandler) Reset(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	if err := h.poolMgr.ResetAccount(id); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to reset account"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "account reset to active"})
}

// GET /api/admin/accounts/{id}/stats — usage stats for a specific account
func (h *AccountsHandler) Stats(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	type periodStats struct {
		Requests     int64   `json:"requests"`
		InputTokens  int64   `json:"input_tokens"`
		OutputTokens int64   `json:"output_tokens"`
	}

	queryStats := func(since time.Time) periodStats {
		var reqs, inp, out int64
		h.db.Model(&database.UsageLog{}).
			Where("account_id = ? AND created_at >= ?", id, since).
			Select("COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0)").
			Row().Scan(&reqs, &inp, &out)
		return periodStats{Requests: reqs, InputTokens: inp, OutputTokens: out}
	}

	now := time.Now().UTC()
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"today": queryStats(now.Truncate(24 * time.Hour)),
		"week":  queryStats(now.AddDate(0, 0, -7)),
		"total": queryStats(time.Time{}),
	})
}

func (h *AccountsHandler) Test(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var account database.ClaudeAccount
	if err := h.db.First(&account, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("account not found"))
		return
	}

	access, err := h.enc.Decrypt(account.AccessToken)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to decrypt token"))
		return
	}

	// Simple test: list models
	req, _ := http.NewRequest("GET", "https://api.anthropic.com/v1/models", nil)
	req.Header.Set("Authorization", "Bearer "+access)
	req.Header.Set("anthropic-version", "2023-06-01")
	// OAuth consumer tokens require these headers
	if strings.HasPrefix(access, "sk-ant-oat") {
		req.Header.Set("Anthropic-Dangerous-Direct-Browser-Access", "true")
		req.Header.Set("Anthropic-Beta", "oauth-2025-04-20")
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, errResp("connection failed: "+err.Error()))
		return
	}
	defer resp.Body.Close()

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"status_code": resp.StatusCode,
		"ok":          resp.StatusCode == http.StatusOK,
	})
}

// GET /api/admin/accounts/{id}/credentials — returns decrypted tokens in credentials.json format
func (h *AccountsHandler) Credentials(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var account database.ClaudeAccount
	if err := h.db.First(&account, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("account not found"))
		return
	}

	access, err := h.enc.Decrypt(account.AccessToken)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to decrypt access token"))
		return
	}
	refresh, err := h.enc.Decrypt(account.RefreshToken)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to decrypt refresh token"))
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

// DELETE /api/admin/accounts/{id}/pool?pool_id=N — unlinks the account from a pool (or all pools if no pool_id)
func (h *AccountsHandler) Unlink(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	poolIDStr := r.URL.Query().Get("pool_id")
	var result *gorm.DB
	if poolIDStr != "" {
		result = h.db.Where("account_id = ? AND pool_id = ?", id, poolIDStr).Delete(&database.AccountPool{})
	} else {
		result = h.db.Where("account_id = ?", id).Delete(&database.AccountPool{})
	}
	if result.Error != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to unlink account"))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/admin/accounts/{id}/quota — fetches Claude.ai usage/quota data for this account
func (h *AccountsHandler) Quota(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var account database.ClaudeAccount
	if err := h.db.First(&account, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("account not found"))
		return
	}

	access, err := h.enc.Decrypt(account.AccessToken)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to decrypt token"))
		return
	}

	req, err := http.NewRequest(http.MethodGet, strings.TrimRight(h.cfg.ClaudeAIURL, "/")+"/api/organizations", nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to build request"))
		return
	}
	req.Header.Set("Authorization", "Bearer "+access)
	req.Header.Set("User-Agent", "Mozilla/5.0 (claude-proxy)")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Anthropic-Dangerous-Direct-Browser-Access", "true")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, errResp("upstream error: "+err.Error()))
		return
	}
	defer resp.Body.Close()

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	io.Copy(w, resp.Body)
}
