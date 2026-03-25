package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"claude-proxy/internal/database"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

type UsersHandler struct {
	db *gorm.DB
}

func NewUsersHandler(db *gorm.DB) *UsersHandler {
	return &UsersHandler{db: db}
}

func (h *UsersHandler) List(w http.ResponseWriter, r *http.Request) {
	var users []database.User
	if err := h.db.Preload("Pool").Preload("Pools").Find(&users).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to fetch users"))
		return
	}
	writeJSON(w, http.StatusOK, users)
}

func (h *UsersHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name              string     `json:"name"`
		PoolID            *uint      `json:"pool_id"`
		PoolIDs           []uint     `json:"pool_ids"`
		TokenExpiresAt    *time.Time `json:"token_expires_at"`
		DailyTokenQuota   int        `json:"daily_token_quota"`
		MonthlyTokenQuota int        `json:"monthly_token_quota"`
		AllowedModels     string     `json:"allowed_models"`
		IPWhitelist       string     `json:"ip_whitelist"`
		MonthlyBudgetUSD  float64    `json:"monthly_budget_usd"`
		ExtraHeaders      string     `json:"extra_headers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}
	if req.Name == "" {
		writeJSON(w, http.StatusBadRequest, errResp("name is required"))
		return
	}

	// Derive primary pool_id from pool_ids if not explicitly set
	poolID := req.PoolID
	if poolID == nil && len(req.PoolIDs) > 0 {
		poolID = &req.PoolIDs[0]
	}

	token := "sk-proxy-" + strings.ReplaceAll(uuid.New().String(), "-", "")

	user := database.User{
		Name:              req.Name,
		APIToken:          token,
		PoolID:            poolID,
		Active:            true,
		TokenExpiresAt:    req.TokenExpiresAt,
		DailyTokenQuota:   req.DailyTokenQuota,
		MonthlyTokenQuota: req.MonthlyTokenQuota,
		AllowedModels:     req.AllowedModels,
		IPWhitelist:       req.IPWhitelist,
		MonthlyBudgetUSD:  req.MonthlyBudgetUSD,
		ExtraHeaders:      req.ExtraHeaders,
	}

	if err := h.db.Create(&user).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to create user"))
		return
	}

	// Sync user_pools join table
	poolIDs := req.PoolIDs
	if len(poolIDs) == 0 && poolID != nil {
		poolIDs = []uint{*poolID}
	}
	syncUserPools(h.db, user.ID, poolIDs)

	h.db.Preload("Pool").Preload("Pools").First(&user, user.ID)
	logAudit(h.db, r, "create_user", "user:"+req.Name, "")
	writeJSON(w, http.StatusCreated, user)
}

func (h *UsersHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var user database.User
	if err := h.db.Preload("Pool").Preload("Pools").First(&user, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("user not found"))
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (h *UsersHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var req struct {
		Name              string   `json:"name"`
		PoolID            *uint    `json:"pool_id"`
		PoolIDs           *[]uint  `json:"pool_ids"`
		Active            *bool    `json:"active"`
		TokenExpiresAt    *string  `json:"token_expires_at"` // ISO string or null
		DailyTokenQuota   *int     `json:"daily_token_quota"`
		MonthlyTokenQuota *int     `json:"monthly_token_quota"`
		AllowedModels     *string  `json:"allowed_models"`
		IPWhitelist       *string  `json:"ip_whitelist"`
		MonthlyBudgetUSD  *float64 `json:"monthly_budget_usd"`
		ExtraHeaders      *string  `json:"extra_headers"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	var user database.User
	if err := h.db.First(&user, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("user not found"))
		return
	}

	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.PoolID != nil {
		updates["pool_id"] = req.PoolID
	}
	if req.Active != nil {
		updates["active"] = *req.Active
	}
	if req.TokenExpiresAt != nil {
		if *req.TokenExpiresAt == "" {
			updates["token_expires_at"] = nil
		} else {
			t, err := time.Parse(time.RFC3339, *req.TokenExpiresAt)
			if err == nil {
				updates["token_expires_at"] = t
			}
		}
	}
	if req.DailyTokenQuota != nil {
		updates["daily_token_quota"] = *req.DailyTokenQuota
	}
	if req.MonthlyTokenQuota != nil {
		updates["monthly_token_quota"] = *req.MonthlyTokenQuota
	}
	if req.AllowedModels != nil {
		updates["allowed_models"] = *req.AllowedModels
	}
	if req.IPWhitelist != nil {
		updates["ip_whitelist"] = *req.IPWhitelist
	}
	if req.MonthlyBudgetUSD != nil {
		updates["monthly_budget_usd"] = *req.MonthlyBudgetUSD
	}
	if req.ExtraHeaders != nil {
		updates["extra_headers"] = *req.ExtraHeaders
	}

	if len(updates) > 0 {
		if err := h.db.Model(&user).Updates(updates).Error; err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp("failed to update user"))
			return
		}
	}

	// Sync user_pools if pool_ids was provided
	if req.PoolIDs != nil {
		poolIDs := *req.PoolIDs
		syncUserPools(h.db, id, poolIDs)
		// Keep legacy pool_id in sync with first pool
		if len(poolIDs) > 0 {
			h.db.Model(&database.User{}).Where("id = ?", id).Update("pool_id", poolIDs[0])
		} else {
			h.db.Model(&database.User{}).Where("id = ?", id).Update("pool_id", nil)
		}
	}

	h.db.Preload("Pool").Preload("Pools").First(&user, id)
	logAudit(h.db, r, "update_user", "user:"+user.Name, "")
	writeJSON(w, http.StatusOK, user)
}

func (h *UsersHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var user database.User
	if err := h.db.First(&user, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("user not found"))
		return
	}

	h.db.Where("user_id = ?", id).Delete(&database.UserPool{})
	if err := h.db.Delete(&database.User{}, id).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to delete user"))
		return
	}

	logAudit(h.db, r, "delete_user", "user:"+user.Name, "")
	writeJSON(w, http.StatusOK, map[string]string{"message": "user deleted"})
}

func (h *UsersHandler) RotateToken(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	token := "sk-proxy-" + strings.ReplaceAll(uuid.New().String(), "-", "")

	if err := h.db.Model(&database.User{}).Where("id = ?", id).
		Update("api_token", token).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to rotate token"))
		return
	}

	logAudit(h.db, r, "rotate_token", "user:"+strconv.Itoa(int(id)), "")
	writeJSON(w, http.StatusOK, map[string]string{"api_token": token})
}

// GenerateSetupLink creates a 48h setup link for an existing user.
// POST /api/admin/users/{id}/setup-link
func (h *UsersHandler) GenerateSetupLink(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}
	var user database.User
	if err := h.db.First(&user, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("user not found"))
		return
	}
	token := strings.ReplaceAll(uuid.New().String(), "-", "") +
		strings.ReplaceAll(uuid.New().String(), "-", "")
	setup := database.SetupToken{
		Token:     token,
		UserID:    user.ID,
		ExpiresAt: time.Now().Add(48 * time.Hour),
	}
	if err := h.db.Create(&setup).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to create setup link"))
		return
	}
	logAudit(h.db, r, "generate_setup_link", "user:"+user.Name, "")
	writeJSON(w, http.StatusCreated, map[string]string{"url": "/setup/" + token})
}

// SetupLinkFetch returns user info and pre-auth download links for a valid setup token.
// GET /api/setup/{token} — public
func (h *UsersHandler) SetupLinkFetch(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	var setup database.SetupToken
	if err := h.db.Where("token = ? AND expires_at > ?", token, time.Now()).
		First(&setup).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("setup link not found or expired"))
		return
	}
	var user database.User
	if err := h.db.Preload("Pools").First(&user, setup.UserID).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("user not found"))
		return
	}
	// Unlimited downloads for setup links so user can install on multiple machines
	downloadLinks := CreateLinksForUser(h.db, user.ID, 0)
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"name":           user.Name,
		"api_token":      user.APIToken,
		"pools":          user.Pools,
		"download_links": downloadLinks,
	})
}

// syncUserPools replaces all user_pools entries for userID with the given poolIDs.
func syncUserPools(db *gorm.DB, userID uint, poolIDs []uint) {
	db.Where("user_id = ?", userID).Delete(&database.UserPool{})
	for _, pid := range poolIDs {
		db.Create(&database.UserPool{UserID: userID, PoolID: pid})
	}
}

func parseID(r *http.Request) (uint, error) {
	idStr := chi.URLParam(r, "id")
	id, err := strconv.ParseUint(idStr, 10, 64)
	if err != nil {
		return 0, err
	}
	return uint(id), nil
}

// GetStats returns today/week/total usage stats + owned Claude accounts for a user.
func (h *UsersHandler) GetStats(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var user database.User
	if err := h.db.First(&user, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("user not found"))
		return
	}

	now := time.Now().UTC()
	todayStart := now.Truncate(24 * time.Hour)
	weekStart := now.AddDate(0, 0, -6).Truncate(24 * time.Hour)

	type period struct {
		Requests     int64 `json:"requests"`
		InputTokens  int64 `json:"input_tokens"`
		OutputTokens int64 `json:"output_tokens"`
	}

	queryPeriod := func(since time.Time) period {
		var p period
		h.db.Model(&database.UsageLog{}).
			Where("user_id = ? AND created_at >= ?", id, since).
			Select("COUNT(*) as requests, COALESCE(SUM(input_tokens),0) as input_tokens, COALESCE(SUM(output_tokens),0) as output_tokens").
			Row().Scan(&p.Requests, &p.InputTokens, &p.OutputTokens)
		return p
	}

	var accounts []database.ClaudeAccount
	h.db.Where("owner_user_id = ?", id).Find(&accounts)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"today":    queryPeriod(todayStart),
		"week":     queryPeriod(weekStart),
		"accounts": accounts,
	})
}
