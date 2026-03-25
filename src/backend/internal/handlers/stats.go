package handlers

import (
	"encoding/csv"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"claude-proxy/internal/database"

	"gorm.io/gorm"
)

// modelPricing maps model name substrings to [inputPerMTok, outputPerMTok] in USD.
var modelPricing = map[string][2]float64{
	"claude-opus-4":          {15.0, 75.0},
	"claude-sonnet-4":        {3.0, 15.0},
	"claude-haiku-4":         {0.80, 4.0},
	"claude-3-5-sonnet":      {3.0, 15.0},
	"claude-3-5-haiku":       {0.80, 4.0},
	"claude-3-opus":          {15.0, 75.0},
	"claude-3-sonnet":        {3.0, 15.0},
	"claude-3-haiku":         {0.25, 1.25},
}

func estimateCost(model string, inputTokens, outputTokens int64) float64 {
	for substr, price := range modelPricing {
		if len(model) >= len(substr) {
			for i := 0; i <= len(model)-len(substr); i++ {
				if model[i:i+len(substr)] == substr {
					input := float64(inputTokens) / 1_000_000 * price[0]
					output := float64(outputTokens) / 1_000_000 * price[1]
					return input + output
				}
			}
		}
	}
	return 0
}

type StatsHandler struct {
	db *gorm.DB
}

func NewStatsHandler(db *gorm.DB) *StatsHandler {
	return &StatsHandler{db: db}
}

func (h *StatsHandler) Overview(w http.ResponseWriter, r *http.Request) {
	var totalRequests int64
	h.db.Model(&database.UsageLog{}).Count(&totalRequests)

	var totalInput, totalOutput, totalCacheRead, totalCacheWrite int64
	h.db.Model(&database.UsageLog{}).
		Select("COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_read),0), COALESCE(SUM(cache_write),0)").
		Row().Scan(&totalInput, &totalOutput, &totalCacheRead, &totalCacheWrite)

	var activeUsers int64
	h.db.Model(&database.User{}).Where("active = ?", true).Count(&activeUsers)

	var totalUsers int64
	h.db.Model(&database.User{}).Count(&totalUsers)

	type accountStatus struct {
		Status string `json:"status"`
		Count  int64  `json:"count"`
	}
	var accountStatuses []accountStatus
	h.db.Model(&database.ClaudeAccount{}).
		Select("status, count(*) as count").
		Group("status").
		Scan(&accountStatuses)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total_requests":    totalRequests,
		"total_input":       totalInput,
		"total_output":      totalOutput,
		"total_cache_read":  totalCacheRead,
		"total_cache_write": totalCacheWrite,
		"estimated_cost":    estimateCostFromDB(h.db),
		"active_users":      activeUsers,
		"total_users":       totalUsers,
		"account_statuses":  accountStatuses,
	})
}

func estimateCostFromDB(db *gorm.DB) float64 {
	type row struct {
		Model        string
		InputTokens  int64
		OutputTokens int64
	}
	var rows []row
	db.Model(&database.UsageLog{}).
		Select("model, COALESCE(SUM(input_tokens),0) as input_tokens, COALESCE(SUM(output_tokens),0) as output_tokens").
		Group("model").Scan(&rows)

	var total float64
	for _, r := range rows {
		total += estimateCost(r.Model, r.InputTokens, r.OutputTokens)
	}
	return total
}

func (h *StatsHandler) Usage(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 200 {
		limit = 50
	}

	q := h.db.Preload("User").Order("created_at DESC")

	if userID := r.URL.Query().Get("user_id"); userID != "" {
		q = q.Where("user_id = ?", userID)
	}
	if model := r.URL.Query().Get("model"); model != "" {
		q = q.Where("model LIKE ?", "%"+model+"%")
	}
	if endpoint := r.URL.Query().Get("endpoint"); endpoint != "" {
		q = q.Where("endpoint LIKE ?", "%"+endpoint+"%")
	}
	if sc := r.URL.Query().Get("status_class"); sc != "" {
		switch sc {
		case "2xx":
			q = q.Where("status_code >= 200 AND status_code < 300")
		case "4xx":
			q = q.Where("status_code >= 400 AND status_code < 500")
		case "5xx":
			q = q.Where("status_code >= 500 AND status_code < 600")
		}
	}
	if from := r.URL.Query().Get("from"); from != "" {
		if t, err := time.Parse(time.RFC3339, from); err == nil {
			q = q.Where("created_at >= ?", t)
		}
	}
	if to := r.URL.Query().Get("to"); to != "" {
		if t, err := time.Parse(time.RFC3339, to); err == nil {
			q = q.Where("created_at <= ?", t)
		}
	}

	var total int64
	q.Model(&database.UsageLog{}).Count(&total)

	var logs []database.UsageLog
	q.Offset((page - 1) * limit).Limit(limit).Find(&logs)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total": total,
		"page":  page,
		"limit": limit,
		"logs":  logs,
	})
}

// GET /api/admin/stats/export — download all usage logs as CSV
func (h *StatsHandler) ExportCSV(w http.ResponseWriter, r *http.Request) {
	var logs []database.UsageLog
	q := h.db.Preload("User").Order("created_at DESC")

	if userID := r.URL.Query().Get("user_id"); userID != "" {
		q = q.Where("user_id = ?", userID)
	}
	if from := r.URL.Query().Get("from"); from != "" {
		if t, err := time.Parse(time.RFC3339, from); err == nil {
			q = q.Where("created_at >= ?", t)
		}
	}
	if to := r.URL.Query().Get("to"); to != "" {
		if t, err := time.Parse(time.RFC3339, to); err == nil {
			q = q.Where("created_at <= ?", t)
		}
	}

	q.Find(&logs)

	w.Header().Set("Content-Type", "text/csv")
	w.Header().Set("Content-Disposition", `attachment; filename="usage-export.csv"`)

	cw := csv.NewWriter(w)
	cw.Write([]string{
		"id", "created_at", "user_id", "user_name", "account_id",
		"model", "endpoint", "status_code",
		"input_tokens", "output_tokens", "cache_read", "cache_write",
		"estimated_cost_usd",
	})

	for _, l := range logs {
		userName := ""
		if l.User != nil {
			userName = l.User.Name
		}
		cost := fmt.Sprintf("%.6f", estimateCost(l.Model, int64(l.InputTokens), int64(l.OutputTokens)))
		cw.Write([]string{
			strconv.Itoa(int(l.ID)),
			l.CreatedAt.UTC().Format(time.RFC3339),
			strconv.Itoa(int(l.UserID)),
			userName,
			strconv.Itoa(int(l.AccountID)),
			l.Model,
			l.Endpoint,
			strconv.Itoa(l.StatusCode),
			strconv.Itoa(l.InputTokens),
			strconv.Itoa(l.OutputTokens),
			strconv.Itoa(l.CacheRead),
			strconv.Itoa(l.CacheWrite),
			cost,
		})
	}

	cw.Flush()
}

func (h *StatsHandler) ByUser(w http.ResponseWriter, r *http.Request) {
	type row struct {
		UserID        uint    `json:"user_id"`
		UserName      string  `json:"user_name"`
		TotalReqs     int64   `json:"total_requests"`
		InputTokens   int64   `json:"input_tokens"`
		OutputTokens  int64   `json:"output_tokens"`
		EstimatedCost float64 `json:"estimated_cost_usd"`
	}

	var rows []row
	h.db.Model(&database.UsageLog{}).
		Select("usage_logs.user_id, users.name as user_name, count(*) as total_reqs, COALESCE(SUM(input_tokens),0) as input_tokens, COALESCE(SUM(output_tokens),0) as output_tokens").
		Joins("LEFT JOIN users ON users.id = usage_logs.user_id").
		Group("usage_logs.user_id").
		Order("input_tokens DESC").
		Scan(&rows)

	// Compute per-user cost (not model-specific, use global estimate from DB)
	for i := range rows {
		// Use a rough estimate assuming a mix — more precise would need per-user model breakdown
		rows[i].EstimatedCost = estimateCostForUser(h.db, rows[i].UserID)
	}

	writeJSON(w, http.StatusOK, rows)
}

func estimateCostForUser(db *gorm.DB, userID uint) float64 {
	type row struct {
		Model        string
		InputTokens  int64
		OutputTokens int64
	}
	var rows []row
	db.Model(&database.UsageLog{}).
		Where("user_id = ?", userID).
		Select("model, COALESCE(SUM(input_tokens),0) as input_tokens, COALESCE(SUM(output_tokens),0) as output_tokens").
		Group("model").Scan(&rows)

	var total float64
	for _, r := range rows {
		total += estimateCost(r.Model, r.InputTokens, r.OutputTokens)
	}
	return total
}

func (h *StatsHandler) ByDay(w http.ResponseWriter, r *http.Request) {
	type row struct {
		Day          string `json:"day"`
		TotalReqs    int64  `json:"total_requests"`
		InputTokens  int64  `json:"input_tokens"`
		OutputTokens int64  `json:"output_tokens"`
	}

	since := time.Now().AddDate(0, 0, -30)

	var rows []row
	h.db.Model(&database.UsageLog{}).
		Select("DATE(created_at) as day, count(*) as total_reqs, COALESCE(SUM(input_tokens),0) as input_tokens, COALESCE(SUM(output_tokens),0) as output_tokens").
		Where("created_at >= ?", since).
		Group("DATE(created_at)").
		Order("day ASC").
		Scan(&rows)

	writeJSON(w, http.StatusOK, rows)
}

func (h *StatsHandler) Latency(w http.ResponseWriter, r *http.Request) {
	since := time.Now().AddDate(0, 0, -30)

	// Fetch all (model, latency_ms) pairs — compute percentiles in Go.
	type rawRow struct {
		Model     string
		LatencyMs int
	}
	var raw []rawRow
	h.db.Model(&database.UsageLog{}).
		Where("latency_ms > 0 AND created_at >= ?", since).
		Select("model, latency_ms").
		Scan(&raw)

	grouped := make(map[string][]int)
	for _, r := range raw {
		grouped[r.Model] = append(grouped[r.Model], r.LatencyMs)
	}

	type result struct {
		Model string `json:"model"`
		P50   int    `json:"p50_ms"`
		P95   int    `json:"p95_ms"`
		P99   int    `json:"p99_ms"`
		Count int    `json:"count"`
	}
	var results []result
	for model, vals := range grouped {
		sort.Ints(vals)
		n := len(vals)
		results = append(results, result{
			Model: model,
			P50:   vals[n*50/100],
			P95:   vals[n*95/100],
			P99:   vals[n*99/100],
			Count: n,
		})
	}
	// Sort by model name for stable output.
	sort.Slice(results, func(i, j int) bool {
		return strings.Compare(results[i].Model, results[j].Model) < 0
	})

	writeJSON(w, http.StatusOK, results)
}

func (h *StatsHandler) ByModel(w http.ResponseWriter, r *http.Request) {
	type row struct {
		Model         string  `json:"model"`
		TotalReqs     int64   `json:"total_requests"`
		InputTokens   int64   `json:"input_tokens"`
		OutputTokens  int64   `json:"output_tokens"`
		EstimatedCost float64 `json:"estimated_cost_usd"`
	}

	var rows []row
	h.db.Model(&database.UsageLog{}).
		Select("model, count(*) as total_reqs, COALESCE(SUM(input_tokens),0) as input_tokens, COALESCE(SUM(output_tokens),0) as output_tokens").
		Group("model").
		Order("total_reqs DESC").
		Scan(&rows)

	for i := range rows {
		rows[i].EstimatedCost = estimateCost(rows[i].Model, rows[i].InputTokens, rows[i].OutputTokens)
	}

	writeJSON(w, http.StatusOK, rows)
}

// GET /api/admin/stats/by-model-day — per-model daily breakdown for the last 30 days
func (h *StatsHandler) ByModelDay(w http.ResponseWriter, r *http.Request) {
	type row struct {
		Day          string `json:"day"`
		Model        string `json:"model"`
		Requests     int64  `json:"requests"`
		InputTokens  int64  `json:"input_tokens"`
		OutputTokens int64  `json:"output_tokens"`
	}

	since := time.Now().AddDate(0, 0, -30)
	var rows []row
	h.db.Model(&database.UsageLog{}).
		Select("DATE(created_at) as day, model, count(*) as requests, COALESCE(SUM(input_tokens),0) as input_tokens, COALESCE(SUM(output_tokens),0) as output_tokens").
		Where("created_at >= ?", since).
		Group("DATE(created_at), model").
		Order("day ASC, requests DESC").
		Scan(&rows)

	writeJSON(w, http.StatusOK, rows)
}

// GET /api/admin/stats/heatmap?days=30 — activity by day-of-week × hour-of-day
func (h *StatsHandler) Heatmap(w http.ResponseWriter, r *http.Request) {
	days := 30
	if d := r.URL.Query().Get("days"); d != "" {
		if v, err := strconv.Atoi(d); err == nil && v > 0 && v <= 90 {
			days = v
		}
	}

	since := time.Now().AddDate(0, 0, -days)

	type point struct {
		DayOfWeek  int   `json:"day_of_week"`  // 0=Sun .. 6=Sat
		HourOfDay  int   `json:"hour_of_day"`
		Count      int64 `json:"count"`
	}
	var points []point
	h.db.Model(&database.UsageLog{}).
		Where("created_at >= ?", since).
		Select("CAST(strftime('%w', created_at) AS INTEGER) as day_of_week, CAST(strftime('%H', created_at) AS INTEGER) as hour_of_day, COUNT(*) as count").
		Group("day_of_week, hour_of_day").
		Scan(&points)

	writeJSON(w, http.StatusOK, points)
}

// GET /api/admin/stats/sessions?hours=168 — session analytics per user (30-min gap threshold)
func (h *StatsHandler) Sessions(w http.ResponseWriter, r *http.Request) {
	hours := 168 // 7 days default
	if v := r.URL.Query().Get("hours"); v != "" {
		if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 && parsed <= 720 {
			hours = parsed
		}
	}

	since := time.Now().Add(-time.Duration(hours) * time.Hour)

	type rawLog struct {
		UserID       uint
		UserName     string
		CreatedAt    time.Time
		InputTokens  int
		OutputTokens int
	}
	var logs []rawLog
	h.db.Model(&database.UsageLog{}).
		Select("usage_logs.user_id, users.name as user_name, usage_logs.created_at, usage_logs.input_tokens, usage_logs.output_tokens").
		Joins("LEFT JOIN users ON users.id = usage_logs.user_id").
		Where("usage_logs.created_at >= ?", since).
		Order("usage_logs.user_id, usage_logs.created_at").
		Scan(&logs)

	// Group into sessions per user (30-min gap threshold)
	const sessionGap = 30 * time.Minute

	type userSession struct {
		start    time.Time
		end      time.Time
		requests int
		input    int
		output   int
	}

	type userAccum struct {
		name     string
		sessions []userSession
		totalIn  int
		totalOut int
	}

	users := make(map[uint]*userAccum)
	for _, log := range logs {
		acc, ok := users[log.UserID]
		if !ok {
			acc = &userAccum{name: log.UserName}
			users[log.UserID] = acc
		}
		acc.totalIn += log.InputTokens
		acc.totalOut += log.OutputTokens

		if len(acc.sessions) == 0 || log.CreatedAt.Sub(acc.sessions[len(acc.sessions)-1].end) > sessionGap {
			acc.sessions = append(acc.sessions, userSession{
				start:    log.CreatedAt,
				end:      log.CreatedAt,
				requests: 1,
				input:    log.InputTokens,
				output:   log.OutputTokens,
			})
		} else {
			s := &acc.sessions[len(acc.sessions)-1]
			s.end = log.CreatedAt
			s.requests++
			s.input += log.InputTokens
			s.output += log.OutputTokens
		}
	}

	type result struct {
		UserID                  uint    `json:"user_id"`
		UserName                string  `json:"user_name"`
		SessionCount            int     `json:"session_count"`
		TotalRequests           int     `json:"total_requests"`
		AvgSessionDurationMin   float64 `json:"avg_session_duration_min"`
		AvgMessagesPerSession   float64 `json:"avg_messages_per_session"`
		TotalInputTokens        int     `json:"total_input_tokens"`
		TotalOutputTokens       int     `json:"total_output_tokens"`
	}

	var results []result
	for uid, acc := range users {
		if len(acc.sessions) == 0 {
			continue
		}
		var totalDur float64
		var totalReqs int
		for _, s := range acc.sessions {
			dur := s.end.Sub(s.start).Minutes()
			if dur < 1 {
				dur = 1
			}
			totalDur += dur
			totalReqs += s.requests
		}
		n := len(acc.sessions)
		results = append(results, result{
			UserID:                uid,
			UserName:              acc.name,
			SessionCount:          n,
			TotalRequests:         totalReqs,
			AvgSessionDurationMin: totalDur / float64(n),
			AvgMessagesPerSession: float64(totalReqs) / float64(n),
			TotalInputTokens:      acc.totalIn,
			TotalOutputTokens:     acc.totalOut,
		})
	}

	sort.Slice(results, func(i, j int) bool {
		return results[i].SessionCount > results[j].SessionCount
	})

	writeJSON(w, http.StatusOK, results)
}
