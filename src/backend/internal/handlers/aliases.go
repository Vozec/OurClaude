package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"claude-proxy/internal/database"

	"github.com/go-chi/chi/v5"
	"gorm.io/gorm"
)

type AliasesHandler struct {
	db *gorm.DB
}

func NewAliasesHandler(db *gorm.DB) *AliasesHandler {
	return &AliasesHandler{db: db}
}

func (h *AliasesHandler) List(w http.ResponseWriter, r *http.Request) {
	var aliases []database.ModelAlias
	h.db.Order("alias asc").Find(&aliases)
	writeJSON(w, http.StatusOK, aliases)
}

func (h *AliasesHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Alias  string `json:"alias"`
		Target string `json:"target"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Alias == "" || req.Target == "" {
		http.Error(w, "alias and target required", http.StatusBadRequest)
		return
	}

	alias := database.ModelAlias{Alias: req.Alias, Target: req.Target}
	if err := h.db.Create(&alias).Error; err != nil {
		http.Error(w, "alias already exists or db error", http.StatusConflict)
		return
	}

	logAudit(h.db, r, "alias.create", fmt.Sprintf("alias:%s", alias.Alias), fmt.Sprintf("target=%s", alias.Target))
	writeJSON(w, http.StatusCreated, alias)
}

func (h *AliasesHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))
	result := h.db.Delete(&database.ModelAlias{}, id)
	if result.Error != nil || result.RowsAffected == 0 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	logAudit(h.db, r, "alias.delete", fmt.Sprintf("alias:%d", id), "")
	w.WriteHeader(http.StatusNoContent)
}
