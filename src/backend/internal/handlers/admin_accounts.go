package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

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
}

func NewAccountsHandler(db *gorm.DB, enc *crypto.Encryptor, oauthRefresher *oauth.Refresher, poolMgr *pool.Manager) *AccountsHandler {
	return &AccountsHandler{db: db, enc: enc, oauth: oauthRefresher, poolMgr: poolMgr}
}

func (h *AccountsHandler) List(w http.ResponseWriter, r *http.Request) {
	var accounts []database.ClaudeAccount
	if err := h.db.Find(&accounts).Error; err != nil {
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
		PoolID          uint   `json:"pool_id"`
		CredentialsJSON string `json:"credentials_json"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	if req.Name == "" || req.PoolID == 0 || req.CredentialsJSON == "" {
		writeJSON(w, http.StatusBadRequest, errResp("name, pool_id and credentials_json are required"))
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

	account := database.ClaudeAccount{
		PoolID:       req.PoolID,
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

	writeJSON(w, http.StatusCreated, account)
}

func (h *AccountsHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var account database.ClaudeAccount
	if err := h.db.Preload("Pool").First(&account, id).Error; err != nil {
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
		Name   string `json:"name"`
		PoolID *uint  `json:"pool_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.PoolID != nil {
		updates["pool_id"] = *req.PoolID
	}

	if err := h.db.Model(&database.ClaudeAccount{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to update account"))
		return
	}

	var account database.ClaudeAccount
	h.db.First(&account, id)
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
