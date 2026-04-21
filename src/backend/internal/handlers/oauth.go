package handlers

import (
	"bytes"
	"io"
	"net/http"
)

const anthropicTokenURL = "https://console.anthropic.com/v1/oauth/token"

type OAuthHandler struct {
	client *http.Client
}

func NewOAuthHandler() *OAuthHandler {
	return &OAuthHandler{client: &http.Client{}}
}

func (h *OAuthHandler) ExchangeToken(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("failed to read request body"))
		return
	}

	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, anthropicTokenURL, bytes.NewReader(body))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("failed to build request"))
		return
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := h.client.Do(req)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, errResp("token exchange request failed"))
		return
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, errResp("failed to read token response"))
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	w.Write(respBody)
}
