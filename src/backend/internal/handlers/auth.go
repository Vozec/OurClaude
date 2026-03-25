package handlers

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"time"

	"claude-proxy/internal/auth"
	"claude-proxy/internal/config"
	"claude-proxy/internal/database"
	"claude-proxy/internal/middleware"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type AuthHandler struct {
	db  *gorm.DB
	cfg *config.Config
}

func NewAuthHandler(db *gorm.DB, cfg *config.Config) *AuthHandler {
	return &AuthHandler{db: db, cfg: cfg}
}

func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
		TOTPCode string `json:"totp_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	var admin database.Admin
	if err := h.db.Where("username = ?", req.Username).First(&admin).Error; err != nil {
		writeJSON(w, http.StatusUnauthorized, errResp("invalid credentials"))
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(req.Password)); err != nil {
		writeJSON(w, http.StatusUnauthorized, errResp("invalid credentials"))
		return
	}

	if admin.TOTPEnabled {
		if req.TOTPCode == "" {
			writeJSON(w, http.StatusUnauthorized, map[string]interface{}{
				"error":        "totp_required",
				"totp_enabled": true,
			})
			return
		}
		if !auth.ValidateTOTPCode(admin.TOTPSecret, req.TOTPCode) {
			writeJSON(w, http.StatusUnauthorized, errResp("invalid TOTP code"))
			return
		}
	}

	token, err := auth.GenerateToken(admin.ID, admin.Username, h.cfg.JWTSecret, h.cfg.JWTExpiry)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to generate session"))
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(h.cfg.JWTExpiry.Seconds()),
	})

	csrfToken := hex.EncodeToString(sha256.New().Sum([]byte(token + "csrf")))[:32]
	http.SetCookie(w, &http.Cookie{
		Name:     "csrf_token",
		Value:    csrfToken,
		Path:     "/",
		HttpOnly: false, // JS must read this
		SameSite: http.SameSiteLaxMode,
		MaxAge:   int(h.cfg.JWTExpiry.Seconds()),
	})

	// Audit log — login happens before JWT context exists, so log manually
	h.db.Create(&database.AuditLog{
		AdminID:       admin.ID,
		AdminUsername: admin.Username,
		Action:        "admin_login",
		Target:        "admin:" + admin.Username,
		Details:       "ip=" + r.RemoteAddr,
	})

	// Record session in DB for the Sessions page
	h.db.Create(&database.AdminSession{
		AdminID:    admin.ID,
		TokenHash:  hashToken(token),
		IP:         r.RemoteAddr,
		UserAgent:  r.Header.Get("User-Agent"),
		LastUsedAt: time.Now(),
		ExpiresAt:  time.Now().Add(h.cfg.JWTExpiry),
	})

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"admin": map[string]interface{}{
			"id":           admin.ID,
			"username":     admin.Username,
			"totp_enabled": admin.TOTPEnabled,
			"role":         admin.Role,
			"created_at":   admin.CreatedAt,
		},
	})
}

func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})
	writeJSON(w, http.StatusOK, map[string]string{"message": "logged out"})
}

func (h *AuthHandler) Me(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetAdmin(r.Context())
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, errResp("unauthorized"))
		return
	}

	var admin database.Admin
	if err := h.db.First(&admin, claims.AdminID).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("admin not found"))
		return
	}

	// Read CSRF token from cookie to include in response (frontend may not be able to read cookie)
	csrfValue := ""
	if c, err := r.Cookie("csrf_token"); err == nil {
		csrfValue = c.Value
	}

	writeJSON(w, http.StatusOK, map[string]interface{}{
		"id":           admin.ID,
		"username":     admin.Username,
		"totp_enabled": admin.TOTPEnabled,
		"role":         admin.Role,
		"created_at":   admin.CreatedAt,
		"csrf_token":   csrfValue,
	})
}

func (h *AuthHandler) TOTPSetup(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetAdmin(r.Context())

	secret, qrURL, err := auth.GenerateTOTPSecret(claims.Username)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to generate TOTP secret"))
		return
	}

	// Store secret temporarily (not enabled yet)
	if err := h.db.Model(&database.Admin{}).Where("id = ?", claims.AdminID).
		Update("totp_secret", secret).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to save TOTP secret"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"secret": secret,
		"qr_url": qrURL,
	})
}

func (h *AuthHandler) TOTPEnable(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetAdmin(r.Context())

	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	var admin database.Admin
	if err := h.db.First(&admin, claims.AdminID).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("admin not found"))
		return
	}

	if !auth.ValidateTOTPCode(admin.TOTPSecret, req.Code) {
		writeJSON(w, http.StatusBadRequest, errResp("invalid TOTP code"))
		return
	}

	if err := h.db.Model(&admin).Update("totp_enabled", true).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to enable TOTP"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "TOTP enabled"})
}

func (h *AuthHandler) TOTPDisable(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetAdmin(r.Context())

	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	var admin database.Admin
	if err := h.db.First(&admin, claims.AdminID).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("admin not found"))
		return
	}

	if !auth.ValidateTOTPCode(admin.TOTPSecret, req.Code) {
		writeJSON(w, http.StatusBadRequest, errResp("invalid TOTP code"))
		return
	}

	if err := h.db.Model(&admin).Updates(map[string]interface{}{
		"totp_enabled": false,
		"totp_secret":  "",
	}).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to disable TOTP"))
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{"message": "TOTP disabled"})
}

func (h *AuthHandler) ChangePassword(w http.ResponseWriter, r *http.Request) {
	claims := middleware.GetAdmin(r.Context())

	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	if len(req.NewPassword) < 8 {
		writeJSON(w, http.StatusBadRequest, errResp("new password must be at least 8 characters"))
		return
	}

	var admin database.Admin
	if err := h.db.First(&admin, claims.AdminID).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("admin not found"))
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(admin.PasswordHash), []byte(req.CurrentPassword)); err != nil {
		writeJSON(w, http.StatusUnauthorized, errResp("incorrect current password"))
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to hash password"))
		return
	}

	if err := h.db.Model(&admin).Update("password_hash", string(hash)).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to update password"))
		return
	}

	// Invalidate session by clearing cookie
	http.SetCookie(w, &http.Cookie{
		Name:     auth.CookieName,
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		MaxAge:   -1,
	})

	writeJSON(w, http.StatusOK, map[string]string{"message": "password changed, please log in again"})
}

func hashToken(token string) string {
	h := sha256.Sum256([]byte(token))
	return hex.EncodeToString(h[:])
}

// helpers

func writeJSON(w http.ResponseWriter, code int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func errResp(msg string) map[string]string {
	return map[string]string{"error": msg}
}

