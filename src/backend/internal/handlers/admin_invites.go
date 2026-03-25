package handlers

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"claude-proxy/internal/database"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type InvitesHandler struct {
	db *gorm.DB
}

func NewInvitesHandler(db *gorm.DB) *InvitesHandler {
	return &InvitesHandler{db: db}
}

// GET /api/admin/invites
func (h *InvitesHandler) List(w http.ResponseWriter, r *http.Request) {
	var invites []database.InviteToken
	h.db.Preload("Pool").Order("created_at DESC").Find(&invites)
	writeJSON(w, http.StatusOK, invites)
}

// POST /api/admin/invites
func (h *InvitesHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Label     string `json:"label"`
		PoolID    *uint  `json:"pool_id"`
		ExpiresIn int    `json:"expires_in_hours"` // default 72
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	if req.ExpiresIn <= 0 {
		req.ExpiresIn = 72
	}

	token := strings.ReplaceAll(uuid.New().String(), "-", "") +
		strings.ReplaceAll(uuid.New().String(), "-", "")

	invite := database.InviteToken{
		Token:     token,
		PoolID:    req.PoolID,
		Label:     req.Label,
		ExpiresAt: time.Now().Add(time.Duration(req.ExpiresIn) * time.Hour),
	}
	if err := h.db.Create(&invite).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to create invite"))
		return
	}

	logAudit(h.db, r, "create_invite", "invite:"+invite.Label, "")

	// Return the token in the response (only time it's visible)
	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"id":         invite.ID,
		"token":      token, // full token
		"label":      invite.Label,
		"pool_id":    invite.PoolID,
		"expires_at": invite.ExpiresAt,
	})
}

// DELETE /api/admin/invites/{id}
func (h *InvitesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	if err := h.db.Delete(&database.InviteToken{}, id).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to delete invite"))
		return
	}

	logAudit(h.db, r, "delete_invite", "invite:"+r.URL.Path, "")
	writeJSON(w, http.StatusOK, map[string]string{"message": "deleted"})
}

// POST /api/invite/use — public endpoint, no admin auth required
func (h *InvitesHandler) Use(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Token string `json:"token"`
		Name  string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}
	if req.Token == "" || req.Name == "" {
		writeJSON(w, http.StatusBadRequest, errResp("token and name are required"))
		return
	}

	var invite database.InviteToken
	if err := h.db.Preload("Pool").Where("token = ?", req.Token).First(&invite).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("invalid or expired invite"))
		return
	}

	if invite.UsedAt != nil {
		writeJSON(w, http.StatusGone, errResp("invite already used"))
		return
	}
	if time.Now().After(invite.ExpiresAt) {
		writeJSON(w, http.StatusGone, errResp("invite has expired"))
		return
	}

	// Create user
	apiToken := "sk-proxy-" + strings.ReplaceAll(uuid.New().String(), "-", "")
	user := database.User{
		Name:     req.Name,
		APIToken: apiToken,
		PoolID:   invite.PoolID,
		Active:   true,
	}
	if err := h.db.Create(&user).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to create account"))
		return
	}

	// Mark invite as used
	now := time.Now()
	h.db.Model(&invite).Updates(map[string]interface{}{
		"used_at": now,
		"used_by": req.Name,
	})

	writeJSON(w, http.StatusCreated, map[string]interface{}{
		"name":      user.Name,
		"api_token": apiToken,
		"pool":      invite.Pool,
	})
}
