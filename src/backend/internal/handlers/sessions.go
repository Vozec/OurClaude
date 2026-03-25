package handlers

import (
	"net/http"
	"strconv"
	"time"

	"claude-proxy/internal/database"
	"claude-proxy/internal/middleware"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

type SessionsHandler struct {
	db *gorm.DB
}

func NewSessionsHandler(db *gorm.DB) *SessionsHandler {
	return &SessionsHandler{db: db}
}

// List returns all active sessions. Super admins see all; viewers see their own.
func (h *SessionsHandler) List(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetAdmin(r.Context())

	var sessions []database.AdminSession
	q := h.db.Preload("Admin").Where("expires_at > ?", time.Now())

	var adminRecord database.Admin
	if err := h.db.First(&adminRecord, claims.AdminID).Error; err == nil && adminRecord.Role != "super_admin" {
		q = q.Where("admin_id = ?", claims.AdminID)
	}

	q.Order("last_used_at desc").Find(&sessions)

	type sessionResponse struct {
		database.AdminSession
		AdminUsername string `json:"admin_username"`
	}
	result := make([]sessionResponse, len(sessions))
	for i, s := range sessions {
		result[i] = sessionResponse{AdminSession: s}
		if s.Admin != nil {
			result[i].AdminUsername = s.Admin.Username
		}
	}

	writeJSON(w, http.StatusOK, result)
}

// Revoke deletes a session by ID. Super admins can revoke any; others only their own.
func (h *SessionsHandler) Revoke(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	claims := middleware.GetAdmin(r.Context())

	q := h.db.Where("id = ?", id)

	var adminRecord database.Admin
	if err := h.db.First(&adminRecord, claims.AdminID).Error; err == nil && adminRecord.Role != "super_admin" {
		q = q.Where("admin_id = ?", claims.AdminID)
	}

	result := q.Delete(&database.AdminSession{})
	if result.Error != nil || result.RowsAffected == 0 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	logAudit(h.db, r, "session.revoke", strconv.Itoa(id), "")
	w.WriteHeader(http.StatusNoContent)
}
