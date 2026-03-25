package handlers

import (
	"encoding/json"
	"net/http"

	"claude-proxy/internal/database"

	"gorm.io/gorm"
)

type MCPHandler struct {
	db *gorm.DB
}

func NewMCPHandler(db *gorm.DB) *MCPHandler {
	return &MCPHandler{db: db}
}

func (h *MCPHandler) List(w http.ResponseWriter, r *http.Request) {
	var servers []database.MCPServer
	h.db.Order("name").Find(&servers)
	writeJSON(w, http.StatusOK, servers)
}

func (h *MCPHandler) Create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name    string `json:"name"`
		Command string `json:"command"`
		Args    string `json:"args"`
		Env     string `json:"env"`
	}
	json.NewDecoder(r.Body).Decode(&req)
	if req.Name == "" || req.Command == "" {
		writeJSON(w, http.StatusBadRequest, errResp("name and command are required"))
		return
	}
	server := database.MCPServer{Name: req.Name, Command: req.Command, Args: req.Args, Env: req.Env}
	if err := h.db.Create(&server).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to create MCP server"))
		return
	}
	logAudit(h.db, r, "create_mcp_server", "mcp:"+req.Name, "")
	writeJSON(w, http.StatusCreated, server)
}

func (h *MCPHandler) Delete(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}
	h.db.Delete(&database.MCPServer{}, id)
	logAudit(h.db, r, "delete_mcp_server", "mcp:"+r.URL.Path, "")
	writeJSON(w, http.StatusOK, map[string]string{"message": "MCP server deleted"})
}
