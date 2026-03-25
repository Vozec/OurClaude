package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"

	"claude-proxy/internal/database"

	"gorm.io/gorm"
)

type ConversationsHandler struct {
	db *gorm.DB
}

func NewConversationsHandler(db *gorm.DB) *ConversationsHandler {
	return &ConversationsHandler{db: db}
}

type conversationSummary struct {
	ID           uint   `json:"id"`
	UserID       uint   `json:"user_id"`
	UserName     string `json:"user_name"`
	UsageLogID   *uint  `json:"usage_log_id,omitempty"`
	Model        string `json:"model"`
	InputTokens  int    `json:"input_tokens"`
	OutputTokens int    `json:"output_tokens"`
	CreatedAt    string `json:"created_at"`
}

// GET /api/admin/conversations?page=1&limit=50&user_id=
func (h *ConversationsHandler) List(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 200 {
		limit = 50
	}

	q := h.db.Model(&database.ConversationLog{}).Preload("User")

	if uid := r.URL.Query().Get("user_id"); uid != "" {
		q = q.Where("user_id = ?", uid)
	}

	var total int64
	q.Count(&total)

	var logs []database.ConversationLog
	q.Offset((page - 1) * limit).Limit(limit).Order("created_at DESC").Find(&logs)

	summaries := make([]conversationSummary, 0, len(logs))
	for _, l := range logs {
		name := ""
		if l.User != nil {
			name = l.User.Name
		}
		summaries = append(summaries, conversationSummary{
			ID:           l.ID,
			UserID:       l.UserID,
			UserName:     name,
			UsageLogID:   l.UsageLogID,
			Model:        l.Model,
			InputTokens:  l.InputTokens,
			OutputTokens: l.OutputTokens,
			CreatedAt:    l.CreatedAt.Format("2006-01-02T15:04:05Z"),
		})
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total": total,
		"page":  page,
		"limit": limit,
		"logs":  summaries,
	})
}

// GET /api/admin/conversations/{id}
func (h *ConversationsHandler) Get(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var log database.ConversationLog
	if err := h.db.Preload("User").First(&log, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("conversation not found"))
		return
	}

	// Parse messages JSON back to []interface{}
	var messages interface{}
	if log.MessagesJSON != "" {
		json.Unmarshal([]byte(log.MessagesJSON), &messages)
	}

	userName := ""
	if log.User != nil {
		userName = log.User.Name
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":            log.ID,
		"user_id":       log.UserID,
		"user_name":     userName,
		"usage_log_id":  log.UsageLogID,
		"model":         log.Model,
		"messages":      messages,
		"response":      log.ResponseText,
		"input_tokens":  log.InputTokens,
		"output_tokens": log.OutputTokens,
		"created_at":    log.CreatedAt,
	})
}

// GET /api/admin/conversations/{id}/export — export a single conversation as downloadable JSON
func (h *ConversationsHandler) ExportOne(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var log database.ConversationLog
	if err := h.db.Preload("User").First(&log, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("conversation not found"))
		return
	}

	var messages interface{}
	if log.MessagesJSON != "" {
		json.Unmarshal([]byte(log.MessagesJSON), &messages)
	}

	userName := ""
	if log.User != nil {
		userName = log.User.Name
	}

	entry := map[string]interface{}{
		"id":            log.ID,
		"user_id":       log.UserID,
		"user_name":     userName,
		"model":         log.Model,
		"messages":      messages,
		"response":      log.ResponseText,
		"input_tokens":  log.InputTokens,
		"output_tokens": log.OutputTokens,
		"created_at":    log.CreatedAt.Format("2006-01-02T15:04:05Z"),
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="conversation-`+strconv.Itoa(int(id))+`.json"`)
	json.NewEncoder(w).Encode(entry)
}

// GET /api/admin/conversations/export
func (h *ConversationsHandler) Export(w http.ResponseWriter, r *http.Request) {
	q := h.db.Model(&database.ConversationLog{}).Preload("User")
	if uid := r.URL.Query().Get("user_id"); uid != "" {
		q = q.Where("user_id = ?", uid)
	}

	var logs []database.ConversationLog
	q.Order("created_at DESC").Find(&logs)

	type exportEntry struct {
		ID           uint        `json:"id"`
		UserID       uint        `json:"user_id"`
		UserName     string      `json:"user_name"`
		Model        string      `json:"model"`
		Messages     interface{} `json:"messages"`
		Response     string      `json:"response"`
		InputTokens  int         `json:"input_tokens"`
		OutputTokens int         `json:"output_tokens"`
		CreatedAt    string      `json:"created_at"`
	}

	entries := make([]exportEntry, 0, len(logs))
	for _, l := range logs {
		var msgs interface{}
		json.Unmarshal([]byte(l.MessagesJSON), &msgs)
		name := ""
		if l.User != nil {
			name = l.User.Name
		}
		entries = append(entries, exportEntry{
			ID:           l.ID,
			UserID:       l.UserID,
			UserName:     name,
			Model:        l.Model,
			Messages:     msgs,
			Response:     l.ResponseText,
			InputTokens:  l.InputTokens,
			OutputTokens: l.OutputTokens,
			CreatedAt:    l.CreatedAt.Format("2006-01-02T15:04:05Z"),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Content-Disposition", `attachment; filename="conversations-export.json"`)
	json.NewEncoder(w).Encode(entries)
}
