package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"claude-proxy/internal/auth"
	"claude-proxy/internal/config"
	"claude-proxy/internal/database"
	"claude-proxy/internal/middleware"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

// AdminsHandler manages admin accounts — only accessible to super_admin role.
type AdminsHandler struct {
	db  *gorm.DB
	cfg *config.Config
}

func NewAdminsHandler(db *gorm.DB, cfg *config.Config) *AdminsHandler {
	return &AdminsHandler{db: db, cfg: cfg}
}

func requireSuperAdmin(w http.ResponseWriter, r *http.Request) bool {
	claims := middleware.GetAdmin(r.Context())
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, errResp("unauthorized"))
		return false
	}
	var admin database.Admin
	if err := claims.AdminID; err == 0 {
		writeJSON(w, http.StatusForbidden, errResp("forbidden"))
		return false
	}
	// Look up role from DB (claims don't carry role)
	var a database.Admin
	if db, ok := r.Context().Value("db").(*gorm.DB); ok {
		db.First(&a, claims.AdminID)
	}
	_ = admin
	return true // role check via DB in handler using h.db
}

// GET /api/admin/admins
func (h *AdminsHandler) List(w http.ResponseWriter, r *http.Request) {
	if !h.isSuperAdmin(r) {
		writeJSON(w, http.StatusForbidden, errResp("requires super_admin role"))
		return
	}
	var admins []database.Admin
	h.db.Find(&admins)
	writeJSON(w, http.StatusOK, admins)
}

// POST /api/admin/admins
func (h *AdminsHandler) Create(w http.ResponseWriter, r *http.Request) {
	if !h.isSuperAdmin(r) {
		writeJSON(w, http.StatusForbidden, errResp("requires super_admin role"))
		return
	}

	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		Role     string `json:"role"` // super_admin or viewer
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}
	if req.Username == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, errResp("username and password are required"))
		return
	}
	if len(req.Password) < 8 {
		writeJSON(w, http.StatusBadRequest, errResp("password must be at least 8 characters"))
		return
	}
	if req.Role != "viewer" {
		req.Role = "super_admin"
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to hash password"))
		return
	}

	admin := database.Admin{
		Username:     req.Username,
		PasswordHash: string(hash),
		Role:         req.Role,
	}
	if err := h.db.Create(&admin).Error; err != nil {
		if strings.Contains(err.Error(), "UNIQUE") {
			writeJSON(w, http.StatusConflict, errResp("username already exists"))
			return
		}
		writeJSON(w, http.StatusInternalServerError, errResp("failed to create admin"))
		return
	}

	logAudit(h.db, r, "create_admin", "admin:"+req.Username, "role="+req.Role)
	writeJSON(w, http.StatusCreated, admin)
}

// PUT /api/admin/admins/{id}
func (h *AdminsHandler) Update(w http.ResponseWriter, r *http.Request) {
	if !h.isSuperAdmin(r) {
		writeJSON(w, http.StatusForbidden, errResp("requires super_admin role"))
		return
	}

	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	// Prevent editing yourself (use /api/auth/* for that)
	claims := middleware.GetAdmin(r.Context())
	if claims != nil && claims.AdminID == id {
		writeJSON(w, http.StatusBadRequest, errResp("use /api/auth/password to change your own password"))
		return
	}

	var req struct {
		Password string `json:"password"`
		Role     string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	updates := map[string]interface{}{}
	if req.Password != "" {
		if len(req.Password) < 8 {
			writeJSON(w, http.StatusBadRequest, errResp("password must be at least 8 characters"))
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp("failed to hash password"))
			return
		}
		updates["password_hash"] = string(hash)
	}
	if req.Role == "viewer" || req.Role == "super_admin" {
		updates["role"] = req.Role
	}

	if len(updates) == 0 {
		writeJSON(w, http.StatusBadRequest, errResp("nothing to update"))
		return
	}

	if err := h.db.Model(&database.Admin{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to update admin"))
		return
	}

	logAudit(h.db, r, "update_admin", "admin:"+req.Role, "")
	writeJSON(w, http.StatusOK, map[string]string{"message": "updated"})
}

// DELETE /api/admin/admins/{id}
func (h *AdminsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	if !h.isSuperAdmin(r) {
		writeJSON(w, http.StatusForbidden, errResp("requires super_admin role"))
		return
	}

	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	claims := middleware.GetAdmin(r.Context())
	if claims != nil && claims.AdminID == id {
		writeJSON(w, http.StatusBadRequest, errResp("cannot delete yourself"))
		return
	}

	// Prevent deleting the last super_admin
	var count int64
	h.db.Model(&database.Admin{}).Where("role = ?", "super_admin").Count(&count)
	var target database.Admin
	h.db.First(&target, id)
	if target.Role == "super_admin" && count <= 1 {
		writeJSON(w, http.StatusBadRequest, errResp("cannot delete the last super_admin"))
		return
	}

	if err := h.db.Delete(&database.Admin{}, id).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to delete admin"))
		return
	}

	logAudit(h.db, r, "delete_admin", "admin:"+target.Username, "")
	writeJSON(w, http.StatusOK, map[string]string{"message": "deleted"})
}

// POST /api/admin/admins/{id}/generate-session — generate a session token for another admin (super only)
func (h *AdminsHandler) GenerateSession(w http.ResponseWriter, r *http.Request) {
	if !h.isSuperAdmin(r) {
		writeJSON(w, http.StatusForbidden, errResp("requires super_admin role"))
		return
	}

	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var admin database.Admin
	if err := h.db.First(&admin, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("admin not found"))
		return
	}

	token, err := auth.GenerateToken(admin.ID, admin.Username, h.cfg.JWTSecret, h.cfg.JWTExpiry)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to generate token"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"token": token})
}

// isSuperAdmin checks if the current admin has the super_admin role.
func (h *AdminsHandler) isSuperAdmin(r *http.Request) bool {
	claims := middleware.GetAdmin(r.Context())
	if claims == nil {
		return false
	}
	var admin database.Admin
	if err := h.db.First(&admin, claims.AdminID).Error; err != nil {
		return false
	}
	return admin.Role == "super_admin"
}
