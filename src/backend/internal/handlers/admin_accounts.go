package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

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

func refreshTokenHash(plaintext string) string {
	h := sha256.Sum256([]byte(plaintext))
	return hex.EncodeToString(h[:])
}

// upsertOAuthAccount creates or updates an account based on refresh token hash (dedup).
// Returns the account and true if it was updated (existing), false if created (new).
func (h *AccountsHandler) upsertOAuthAccount(name string, accessToken, refreshToken string, expiresAt time.Time, ownerUserID *uint) (*database.ClaudeAccount, bool, error) {
	encAccess, err := h.enc.Encrypt(accessToken)
	if err != nil {
		return nil, false, fmt.Errorf("encrypt access: %w", err)
	}
	encRefresh, err := h.enc.Encrypt(refreshToken)
	if err != nil {
		return nil, false, fmt.Errorf("encrypt refresh: %w", err)
	}
	hash := refreshTokenHash(refreshToken)

	// Check for existing account with same refresh token
	var existing database.ClaudeAccount
	if err := h.db.Where("refresh_token_hash = ?", hash).First(&existing).Error; err == nil {
		// Update existing
		h.db.Model(&existing).Updates(map[string]interface{}{
			"access_token":  encAccess,
			"refresh_token": encRefresh,
			"expires_at":    expiresAt,
			"status":        "active",
			"last_error":    "",
		})
		return &existing, true, nil
	}

	// Create new
	account := database.ClaudeAccount{
		Name:             name,
		AccountType:      "oauth",
		AccessToken:      encAccess,
		RefreshToken:     encRefresh,
		RefreshTokenHash: hash,
		ExpiresAt:        expiresAt,
		Status:           "active",
		OwnerUserID:      ownerUserID,
	}
	if err := h.db.Create(&account).Error; err != nil {
		return nil, false, fmt.Errorf("create: %w", err)
	}
	return &account, false, nil
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
		PoolIDs         []uint `json:"pool_ids"`
		AccountType     string `json:"account_type"`     // "oauth" (default) or "apikey"
		CredentialsJSON string `json:"credentials_json"` // for oauth
		APIKey          string `json:"api_key"`           // for apikey
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	if req.Name == "" {
		writeJSON(w, http.StatusBadRequest, errResp("name is required"))
		return
	}

	var account database.ClaudeAccount

	if req.AccountType == "apikey" {
		// API key account
		if req.APIKey == "" {
			writeJSON(w, http.StatusBadRequest, errResp("api_key is required for API key accounts"))
			return
		}
		encKey, err := h.enc.Encrypt(req.APIKey)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp("failed to encrypt API key"))
			return
		}
		encEmpty, err := h.enc.Encrypt("")
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp("failed to encrypt"))
			return
		}
		account = database.ClaudeAccount{
			Name:         req.Name,
			AccountType:  "apikey",
			AccessToken:  encKey,
			RefreshToken: encEmpty,
			ExpiresAt:    time.Date(2099, 1, 1, 0, 0, 0, 0, time.UTC),
			Status:       "disabled",
		}
	} else {
		// OAuth account (default)
		if req.CredentialsJSON == "" {
			writeJSON(w, http.StatusBadRequest, errResp("credentials_json is required for OAuth accounts"))
			return
		}
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
		acc, updated, err := h.upsertOAuthAccount(req.Name, creds.ClaudeAiOauth.AccessToken, creds.ClaudeAiOauth.RefreshToken, expiresAt, nil)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp("failed to create account: "+err.Error()))
			return
		}
		account = *acc
		if updated {
			h.db.Preload("Pools").First(&account, account.ID)
			logAudit(h.db, r, "create_account", "account:"+req.Name, "deduplicated — updated existing")
			writeJSON(w, http.StatusOK, account)
			return
		}
	}

	if account.ID == 0 {
		if err := h.db.Create(&account).Error; err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp("failed to create account"))
			return
		}
	}

	// Create join table entries
	for _, pid := range req.PoolIDs {
		h.db.Create(&database.AccountPool{AccountID: account.ID, PoolID: pid})
	}

	h.db.Preload("Pools").First(&account, account.ID)
	logAudit(h.db, r, "create_account", "account:"+req.Name, "")
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
		Name        string  `json:"name"`
		PoolIDs     *[]uint `json:"pool_ids"`
		OwnerUserID *uint   `json:"owner_user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.OwnerUserID != nil {
		if *req.OwnerUserID == 0 {
			updates["owner_user_id"] = nil // unassign
		} else {
			updates["owner_user_id"] = *req.OwnerUserID
		}
	}

	if len(updates) > 0 {
		if err := h.db.Model(&database.ClaudeAccount{}).Where("id = ?", id).Updates(updates).Error; err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp("failed to update account"))
			return
		}
	}

	// Sync pool assignments if provided
	if req.PoolIDs != nil {
		// Delete existing links and re-create
		h.db.Where("account_id = ?", id).Delete(&database.AccountPool{})
		for _, pid := range *req.PoolIDs {
			if pid != 0 {
				h.db.Create(&database.AccountPool{AccountID: uint(id), PoolID: pid})
			}
		}
	}

	var account database.ClaudeAccount
	h.db.Preload("Pools").First(&account, id)
	logAudit(h.db, r, "update_account", fmt.Sprintf("account:%s", account.Name), "")
	writeJSON(w, http.StatusOK, account)
}

func (h *AccountsHandler) Delete(w http.ResponseWriter, r *http.Request) {
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
	h.db.Where("account_id = ?", id).Delete(&database.AccountPool{})
	if err := h.db.Delete(&database.ClaudeAccount{}, id).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to delete account"))
		return
	}
	logAudit(h.db, r, "delete_account", "account:"+account.Name, "")
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

	if account.AccountType == "apikey" {
		writeJSON(w, http.StatusBadRequest, errResp("API key accounts don't need token refresh"))
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

	logAudit(h.db, r, "refresh_account", "account:"+account.Name, "")
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

	logAudit(h.db, r, "reset_account", fmt.Sprintf("account:%d", id), "")
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
		EstCostUSD   float64 `json:"est_cost_usd"`
	}

	queryStats := func(since time.Time) periodStats {
		var reqs, inp, out int64
		h.db.Model(&database.UsageLog{}).
			Where("account_id = ? AND created_at >= ?", id, since).
			Select("COUNT(*), COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0)").
			Row().Scan(&reqs, &inp, &out)

		// Compute cost by model breakdown
		type modelRow struct {
			Model        string
			InputTokens  int64
			OutputTokens int64
		}
		var models []modelRow
		h.db.Model(&database.UsageLog{}).
			Where("account_id = ? AND created_at >= ?", id, since).
			Select("model, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens").
			Group("model").Scan(&models)
		var cost float64
		for _, m := range models {
			cost += EstimateCost(m.Model, m.InputTokens, m.OutputTokens)
		}

		return periodStats{Requests: reqs, InputTokens: inp, OutputTokens: out, EstCostUSD: cost}
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
	logAudit(h.db, r, "unlink_account", fmt.Sprintf("account:%d", id), "pool_id="+poolIDStr)
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/admin/accounts/{id}/quota — returns cached Anthropic usage quota for this account
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

	if account.AccountType == "apikey" {
		writeJSON(w, http.StatusBadRequest, errResp("quota check only available for OAuth accounts"))
		return
	}

	var quota database.AccountQuota
	if err := h.db.Where("account_id = ?", id).First(&quota).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("no quota data yet — poller may not have run"))
		return
	}

	writeJSON(w, http.StatusOK, quota)
}

// GET /api/admin/quotas — returns all account quotas (for Quotas page)
func (h *AccountsHandler) AllQuotas(w http.ResponseWriter, r *http.Request) {
	// Return ALL OAuth accounts, with quota data if available
	var accounts []database.ClaudeAccount
	h.db.Preload("Pools").Where("account_type = ?", "oauth").Find(&accounts)

	type quotaWithAccount struct {
		database.AccountQuota
		AccountName string           `json:"account_name"`
		AccountType string           `json:"account_type"`
		Status      string           `json:"status"`
		Pools       []*database.Pool `json:"pools,omitempty"`
	}

	result := make([]quotaWithAccount, 0, len(accounts))
	for _, acc := range accounts {
		entry := quotaWithAccount{
			AccountName: acc.Name,
			AccountType: acc.AccountType,
			Status:      acc.Status,
			Pools:       acc.Pools,
		}
		// Try to find quota data for this account
		var q database.AccountQuota
		if err := h.db.Where("account_id = ?", acc.ID).First(&q).Error; err == nil {
			entry.AccountQuota = q
		} else {
			// No quota data yet — set account_id so frontend can identify it
			entry.AccountQuota.AccountID = acc.ID
		}
		result = append(result, entry)
	}

	writeJSON(w, http.StatusOK, result)
}

// POST /api/admin/accounts/{id}/toggle — toggle active/disabled status
func (h *AccountsHandler) ToggleStatus(w http.ResponseWriter, r *http.Request) {
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

	newStatus := "active"
	if account.Status != "disabled" {
		newStatus = "disabled"
	}

	h.db.Model(&account).Update("status", newStatus)
	logAudit(h.db, r, "toggle_account", fmt.Sprintf("account:%s", account.Name), fmt.Sprintf("status=%s", newStatus))
	writeJSON(w, http.StatusOK, map[string]string{"status": newStatus})
}

// POST /api/admin/accounts/import-credentials — import account from raw credentials.json
func (h *AccountsHandler) ImportCredentials(w http.ResponseWriter, r *http.Request) {
	var creds credentialsJSON
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid credentials JSON — expected {claudeAiOauth: {accessToken, refreshToken, expiresAt}}"))
		return
	}
	if creds.ClaudeAiOauth.AccessToken == "" || creds.ClaudeAiOauth.RefreshToken == "" {
		writeJSON(w, http.StatusBadRequest, errResp("missing accessToken or refreshToken in claudeAiOauth"))
		return
	}

	var expiresAt time.Time
	if creds.ClaudeAiOauth.ExpiresAt > 0 {
		expiresAt = time.UnixMilli(creds.ClaudeAiOauth.ExpiresAt)
	} else {
		expiresAt = time.Now().Add(1 * time.Hour)
	}

	account, updated, err := h.upsertOAuthAccount("Imported "+time.Now().Format("2006-01-02 15:04"), creds.ClaudeAiOauth.AccessToken, creds.ClaudeAiOauth.RefreshToken, expiresAt, nil)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed: "+err.Error()))
		return
	}

	action := "import_credentials"
	if updated {
		action = "import_credentials_updated"
	}
	logAudit(h.db, r, action, fmt.Sprintf("account:%d", account.ID), "")
	writeJSON(w, http.StatusCreated, account)
}

// POST /api/import/{token} — public pre-auth import using setup token
func (h *AccountsHandler) PublicImport(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")

	var setup database.SetupToken
	if err := h.db.Where("token = ? AND expires_at > ?", token, time.Now()).First(&setup).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("invalid or expired setup token"))
		return
	}

	var user database.User
	if err := h.db.First(&user, setup.UserID).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("user not found"))
		return
	}

	var creds credentialsJSON
	if err := json.NewDecoder(r.Body).Decode(&creds); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid JSON — expected {claudeAiOauth: {accessToken, refreshToken, expiresAt}}"))
		return
	}
	if creds.ClaudeAiOauth.AccessToken == "" || creds.ClaudeAiOauth.RefreshToken == "" {
		writeJSON(w, http.StatusBadRequest, errResp("missing accessToken or refreshToken"))
		return
	}

	var expiresAt time.Time
	if creds.ClaudeAiOauth.ExpiresAt > 0 {
		expiresAt = time.UnixMilli(creds.ClaudeAiOauth.ExpiresAt)
	} else {
		expiresAt = time.Now().Add(1 * time.Hour)
	}

	account, updated, err := h.upsertOAuthAccount(user.Name+" (imported)", creds.ClaudeAiOauth.AccessToken, creds.ClaudeAiOauth.RefreshToken, expiresAt, &user.ID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed: "+err.Error()))
		return
	}

	// Link to user's pools if new account
	if !updated {
		var poolIDs []uint
		h.db.Table("user_pools").Where("user_id = ?", user.ID).Pluck("pool_id", &poolIDs)
		for _, pid := range poolIDs {
			h.db.Create(&database.AccountPool{AccountID: account.ID, PoolID: pid})
		}
	}

	status := "created"
	if updated {
		status = "updated (duplicate detected)"
	}
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"message":    "account " + status,
		"account_id": account.ID,
	})
}
