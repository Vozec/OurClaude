package handlers

import (
	"net/http"
	"strconv"

	"claude-proxy/internal/database"
	"claude-proxy/internal/middleware"

	"gorm.io/gorm"
)

// logAudit persists an audit event. Should be called after successful mutations.
func logAudit(db *gorm.DB, r *http.Request, action, target, details string) {
	claims := middleware.GetAdmin(r.Context())
	if claims == nil {
		return
	}
	db.Create(&database.AuditLog{
		AdminID:       claims.AdminID,
		AdminUsername: claims.Username,
		Action:        action,
		Target:        target,
		Details:       details,
	})
}

// AuditHandler serves /api/admin/audit
type AuditHandler struct {
	db *gorm.DB
}

func NewAuditHandler(db *gorm.DB) *AuditHandler {
	return &AuditHandler{db: db}
}

// GET /api/admin/audit
func (h *AuditHandler) List(w http.ResponseWriter, r *http.Request) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	if page < 1 {
		page = 1
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 200 {
		limit = 50
	}

	q := h.db.Order("created_at DESC")

	if adminID := r.URL.Query().Get("admin_id"); adminID != "" {
		q = q.Where("admin_id = ?", adminID)
	}
	if action := r.URL.Query().Get("action"); action != "" {
		q = q.Where("action = ?", action)
	}

	var total int64
	q.Model(&database.AuditLog{}).Count(&total)

	var logs []database.AuditLog
	q.Offset((page - 1) * limit).Limit(limit).Find(&logs)

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"total": total,
		"page":  page,
		"limit": limit,
		"logs":  logs,
	})
}
