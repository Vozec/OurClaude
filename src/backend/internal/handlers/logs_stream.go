package handlers

import (
	"net/http"

	"claude-proxy/internal/sse"
)

// LogStreamHandler wraps the SSE broadcaster so the admin router can serve it.
type LogStreamHandler struct {
	broadcaster *sse.Broadcaster
}

func NewLogStreamHandler(b *sse.Broadcaster) *LogStreamHandler {
	return &LogStreamHandler{broadcaster: b}
}

func (h *LogStreamHandler) Stream(w http.ResponseWriter, r *http.Request) {
	h.broadcaster.ServeHTTP(w, r)
}
