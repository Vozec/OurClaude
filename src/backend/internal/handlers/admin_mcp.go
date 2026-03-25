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
		Type    string `json:"type"` // "command" or "http"
		Command string `json:"command"`
		Args    string `json:"args"`
		URL     string `json:"url"`
		Env     string `json:"env"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}
	if req.Type == "" {
		req.Type = "command"
	}
	if req.Name == "" {
		writeJSON(w, http.StatusBadRequest, errResp("name is required"))
		return
	}
	if req.Type == "command" && req.Command == "" {
		writeJSON(w, http.StatusBadRequest, errResp("command is required for command-type servers"))
		return
	}
	if req.Type == "http" && req.URL == "" {
		writeJSON(w, http.StatusBadRequest, errResp("url is required for http-type servers"))
		return
	}
	server := database.MCPServer{Name: req.Name, Type: req.Type, Command: req.Command, Args: req.Args, URL: req.URL, Env: req.Env}
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
	var server database.MCPServer
	if err := h.db.First(&server, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("MCP server not found"))
		return
	}
	if err := h.db.Delete(&database.MCPServer{}, id).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to delete MCP server"))
		return
	}
	logAudit(h.db, r, "delete_mcp_server", "mcp:"+server.Name, "")
	writeJSON(w, http.StatusOK, map[string]string{"message": "MCP server deleted"})
}

func (h *MCPHandler) Update(w http.ResponseWriter, r *http.Request) {
	id, err := parseID(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid id"))
		return
	}
	var req struct {
		Name    string `json:"name"`
		Type    string `json:"type"`
		Command string `json:"command"`
		Args    string `json:"args"`
		URL     string `json:"url"`
		Env     string `json:"env"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("invalid request body"))
		return
	}
	updates := map[string]interface{}{}
	if req.Name != "" {
		updates["name"] = req.Name
	}
	if req.Type != "" {
		updates["type"] = req.Type
	}
	if req.Command != "" {
		updates["command"] = req.Command
	}
	if req.Args != "" {
		updates["args"] = req.Args
	}
	if req.URL != "" {
		updates["url"] = req.URL
	}
	if req.Env != "" {
		updates["env"] = req.Env
	}
	if err := h.db.Model(&database.MCPServer{}).Where("id = ?", id).Updates(updates).Error; err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to update"))
		return
	}
	var server database.MCPServer
	if err := h.db.First(&server, id).Error; err != nil {
		writeJSON(w, http.StatusNotFound, errResp("not found"))
		return
	}
	writeJSON(w, http.StatusOK, server)
}
