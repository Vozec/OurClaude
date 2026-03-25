package sse

import (
	"fmt"
	"net/http"
	"sync"
)

// Broadcaster is a simple fan-out pub/sub for SSE clients.
type Broadcaster struct {
	mu   sync.RWMutex
	subs map[chan []byte]struct{}
}

func New() *Broadcaster {
	return &Broadcaster{subs: make(map[chan []byte]struct{})}
}

func (b *Broadcaster) Subscribe() chan []byte {
	ch := make(chan []byte, 16)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *Broadcaster) Unsubscribe(ch chan []byte) {
	b.mu.Lock()
	delete(b.subs, ch)
	b.mu.Unlock()
	close(ch)
}

func (b *Broadcaster) Publish(data []byte) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.subs {
		select {
		case ch <- data:
		default: // drop if subscriber is too slow
		}
	}
}

// ServeHTTP streams events to the client until the connection closes.
// data payloads are expected to be JSON — they are wrapped in SSE format.
func (b *Broadcaster) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("X-Accel-Buffering", "no")

	ch := b.Subscribe()
	defer b.Unsubscribe(ch)

	// Send a connected ping.
	fmt.Fprintf(w, "event: connected\ndata: {}\n\n")
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case msg, ok := <-ch:
			if !ok {
				return
			}
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
		}
	}
}
