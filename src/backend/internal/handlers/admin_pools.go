package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"claude-proxy/internal/database"
	"claude-proxy/internal/pool"

	"gorm.io/gorm"
)

type PoolsHandler struct {
	db      *gorm.DB
	poolMgr *pool.Manager
}

func NewPoolsHandler(db *gorm.DB, poolMgr *pool.Manager) *PoolsHandler {
	return &PoolsHandler{db: db, poolMgr: poolMgr}
}

func (h *PoolsHandler) List(w http.ResponseWriter, r *http.Request) {
	var pools []database.Pool
	if err := h.db.Preload("Accounts").Find(&pools).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to fetch pools"))
		return
	}
	writeJSON(w, http.StatusOK, pools)
}

func (h *PoolsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name              string `json:"name"`
		Description       string `json:"description"`
		DailyTokenQuota   int    `json:"daily_token_quota"`
		MonthlyTokenQuota int    `json:"monthly_token_quota"`
		AllowedModels     string `json:"allowed_models"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	if req.Name == "" {
		writeJSON(w, http.StatusBadRequest, errResp("name is required"))
		return
	}

	p := database.Pool{
		Name:              req.Name,
		Description:       req.Description,
		DailyTokenQuota:   req.DailyTokenQuota,
		MonthlyTokenQuota: req.MonthlyTokenQuota,
		AllowedModels:     req.AllowedModels,
	}

	if err := h.db.Create(&p).Error; err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeJSON(w, http.StatusConflict, errResp("pool name already exists"))
			return
		}
		writeJSON(w, http.StatusInternalServerError, errResp("failed to create pool"))
		return
	}

	writeJSON(w, http.StatusCreated, p)
}

func (h *PoolsHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var p database.Pool
	if err := h.db.Preload("Accounts").First(&p, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("pool not found"))
		return
	}
	writeJSON(w, http.StatusOK, p)
}

func (h *PoolsHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var req struct {
		Name              string  `json:"name"`
		Description       string  `json:"description"`
		DailyTokenQuota   *int    `json:"daily_token_quota"`
		MonthlyTokenQuota *int    `json:"monthly_token_quota"`
		AllowedModels     *string `json:"allowed_models"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	var p database.Pool
	if err := h.db.First(&p, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("pool not found"))
		return
	}

	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Description != "" {
		updates["description"] = req.Description
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

	if err := h.db.Model(&p).Updates(updates).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to update pool"))
		return
	}

	writeJSON(w, http.StatusOK, p)
}

func (h *PoolsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	// Check if users are assigned
	var count int64
	h.db.Model(&database.User{}).Where("pool_id = ?", id).Count(&count)
	if count > 0 {
		writeJSON(w, http.StatusConflict, errResp("cannot delete pool with assigned users"))
		return
	}

	if err := h.db.Delete(&database.Pool{}, id).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to delete pool"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "pool deleted"})
}

func (h *PoolsHandler) Reset(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	if err := h.poolMgr.ResetPool(id); err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to reset pool"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "pool reset: exhausted accounts reactivated"})
}

// GET /api/admin/pools/{id}/stats — usage stats for a specific pool
func (h *PoolsHandler) Stats(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	// Verify pool exists
	var p database.Pool
	if err := h.db.Preload("Accounts").First(&p, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("pool not found"))
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
			Joins("JOIN claude_accounts ON usage_logs.account_id = claude_accounts.id").
			Joins("JOIN account_pools ON account_pools.account_id = claude_accounts.id").
			Where("account_pools.pool_id = ? AND usage_logs.created_at >= ?", id, since).
			Select("COUNT(*), COALESCE(SUM(usage_logs.input_tokens),0), COALESCE(SUM(usage_logs.output_tokens),0)").
			Row().Scan(&reqs, &inp, &out)
		cost := (float64(inp)/1e6)*3.0 + (float64(out)/1e6)*15.0
		return periodStats{Requests: reqs, InputTokens: inp, OutputTokens: out, EstCostUSD: cost}
	}

	now := time.Now().UTC()
	today := now.Truncate(24 * time.Hour)
	weekAgo := now.AddDate(0, 0, -7)
	monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"pool":       p,
		"today":      queryStats(today),
		"week":       queryStats(weekAgo),
		"month":      queryStats(monthStart),
	})
}

// GET /api/admin/pools/{id}/users — users assigned to this pool
func (h *PoolsHandler) Users(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var users []database.User
	if err := h.db.Where("pool_id = ?", id).Find(&users).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to fetch users"))
		return
	}

	writeJSON(w, http.StatusOK, users)
}

// GET /api/admin/pools/{id}/quotas — average Anthropic quotas across accounts in this pool
func (h *PoolsHandler) Quotas(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	// Get account IDs in this pool
	var accountIDs []uint
	h.db.Table("account_pools").Where("pool_id = ?", id).Pluck("account_id", &accountIDs)

	if len(accountIDs) == 0 {
		writeJSON(w, http.StatusOK, map[string]interface{}{
			"count": 0, "avg_five_hour_pct": 0, "avg_seven_day_pct": 0, "quotas": []interface{}{},
		})
		return
	}

	var quotas []database.AccountQuota
	h.db.Where("account_id IN ?", accountIDs).Find(&quotas)

	var sumFive, sumSeven int
	for _, q := range quotas {
		sumFive += q.FiveHourPct
		sumSeven += q.SevenDayPct
	}
	n := len(quotas)
	if n == 0 {
		n = 1
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"count":             len(quotas),
		"avg_five_hour_pct": sumFive / n,
		"avg_seven_day_pct": sumSeven / n,
		"quotas":            quotas,
	})
}
