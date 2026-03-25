package handlers

import (
	"encoding/json"
	"net/http"

	"claude-proxy/internal/database"

	"gorm.io/gorm"
)

type WebhooksHandler struct {
	db *gorm.DB
}

func NewWebhooksHandler(db *gorm.DB) *WebhooksHandler {
	return &WebhooksHandler{db: db}
}

// GET /api/admin/webhooks
func (h *WebhooksHandler) List(w http.ResponseWriter, r *http.Request) {
	var hooks []database.WebhookConfig
	h.db.Find(&hooks)
	// Never expose secrets in list
	for i := range hooks {
		hooks[i].Secret = ""
	}
	writeJSON(w, http.StatusOK, hooks)
}

// POST /api/admin/webhooks
func (h *WebhooksHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL    string `json:"url"`
		Events string `json:"events"` // e.g. "account.exhausted,account.error"
		Secret string `json:"secret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}
	if req.URL == "" || req.Events == "" {
		writeJSON(w, http.StatusBadRequest, errResp("url and events are required"))
		return
	}

	hook := database.WebhookConfig{
		URL:    req.URL,
		Events: req.Events,
		Secret: req.Secret,
		Active: true,
	}
	if err := h.db.Create(&hook).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to create webhook"))
		return
	}

	logAudit(h.db, r, "create_webhook", "webhook:"+req.URL, "events="+req.Events)
	// Return with secret only on creation
	writeJSON(w, http.StatusCreated, hook)
}

// PUT /api/admin/webhooks/{id}
func (h *WebhooksHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var req struct {
		URL    string `json:"url"`
		Events string `json:"events"`
		Active *bool  `json:"active"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	updates := map[string]interface{}{}
	if req.URL != "" {
		updates["url"] = req.URL
	}
	if req.Events != "" {
		updates["events"] = req.Events
	}
	if req.Active != nil {
		updates["active"] = *req.Active
	}

	if err := h.db.Model(&database.WebhookConfig{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to update webhook"))
		return
	}

	logAudit(h.db, r, "update_webhook", "webhook:"+r.URL.Path, "")
	writeJSON(w, http.StatusOK, map[string]string{"message": "updated"})
}

// DELETE /api/admin/webhooks/{id}
func (h *WebhooksHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	if err := h.db.Delete(&database.WebhookConfig{}, id).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to delete webhook"))
		return
	}

	logAudit(h.db, r, "delete_webhook", "webhook:"+r.URL.Path, "")
	writeJSON(w, http.StatusOK, map[string]string{"message": "deleted"})
}

// POST /api/admin/webhooks/{id}/test — send a test payload
func (h *WebhooksHandler) Test(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}

	var hook database.WebhookConfig
	if err := h.db.First(&hook, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("webhook not found"))
		return
	}

	// We don't have direct access to the dispatcher here, so we return the payload
	// the receiver would get. The server wires in the dispatcher separately.
	writeJSON(w, http.StatusOK, map[string]interface{}{
		"message": "test endpoint — trigger a real event or call the webhook URL manually",
		"url":     hook.URL,
		"events":  hook.Events,
	})
}
