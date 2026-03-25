package handlers

import (
	"encoding/json"
	"net/http"

	"claude-proxy/internal/settings"
)

type SettingsHandler struct {
	svc *settings.Service
}

func NewSettingsHandler(svc *settings.Service) *SettingsHandler {
	return &SettingsHandler{svc: svc}
}

// GET /api/admin/settings — returns all editable runtime settings
func (h *SettingsHandler) List(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.svc.All())
}

// PUT /api/admin/settings — updates one or more settings
func (h *SettingsHandler) Update(w http.ResponseWriter, r *http.Request) {
	var req map[string]string
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}

	// Only allow known keys
	allowed := map[string]bool{
		"system_prompt_inject": true,
		"prompt_cache_inject":  true,
		"response_cache_ttl":   true,
		"user_max_rpm":         true,
		"quota_poll_interval":  true,
	}

	for k, v := range req {
		if !allowed[k] {
			continue
		}
		if err := h.svc.Set(k, v); err != nil {
			writeJSON(w, http.StatusInternalServerError, errResp("failed to update setting: "+k))
			return
		}
	}

	writeJSON(w, http.StatusOK, h.svc.All())
}
