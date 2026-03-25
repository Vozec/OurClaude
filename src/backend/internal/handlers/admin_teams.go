package handlers

import (
	"encoding/json"
	"net/http"

	"claude-proxy/internal/database"

	"gorm.io/gorm"
)

type TeamsHandler struct {
	db *gorm.DB
}

func NewTeamsHandler(db *gorm.DB) *TeamsHandler {
	return &TeamsHandler{db: db}
}

func (h *TeamsHandler) List(w http.ResponseWriter, r *http.Request) {
	var teams []database.Team
	h.db.Find(&teams)
	writeJSON(w, http.StatusOK, teams)
}

func (h *TeamsHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name              string  `json:"name"`
		MonthlyBudgetUSD  float64 `json:"monthly_budget_usd"`
		MonthlyTokenQuota int     `json:"monthly_token_quota"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}
	if req.Name == "" {
		writeJSON(w, http.StatusBadRequest, errResp("name is required"))
		return
	}
	team := database.Team{Name: req.Name, MonthlyBudgetUSD: req.MonthlyBudgetUSD, MonthlyTokenQuota: req.MonthlyTokenQuota}
	if err := h.db.Create(&team).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to create team"))
		return
	}
	logAudit(h.db, r, "create_team", "team:"+req.Name, "")
	writeJSON(w, http.StatusCreated, team)
}

func (h *TeamsHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}
	var req struct {
		Name              string   `json:"name"`
		MonthlyBudgetUSD  *float64 `json:"monthly_budget_usd"`
		MonthlyTokenQuota *int     `json:"monthly_token_quota"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}
	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.MonthlyBudgetUSD != nil {
		updates["monthly_budget_usd"] = *req.MonthlyBudgetUSD
	}
	if req.MonthlyTokenQuota != nil {
		updates["monthly_token_quota"] = *req.MonthlyTokenQuota
	}
	if err := h.db.Model(&database.Team{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to update team"))
		return
	}
	var team database.Team
	if err := h.db.First(&team, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("team not found"))
		return
	}
	writeJSON(w, http.StatusOK, team)
}

func (h *TeamsHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}
	var team database.Team
	if err := h.db.First(&team, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("team not found"))
		return
	}
	if err := h.db.Delete(&database.Team{}, id).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to delete team"))
		return
	}
	logAudit(h.db, r, "delete_team", "team:"+team.Name, "")
	writeJSON(w, http.StatusOK, map[string]string{"message": "team deleted"})
}
