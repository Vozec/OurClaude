package webhook

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"

	"claude-proxy/internal/database"

	"gorm.io/gorm"
)

// Dispatcher sends HTTP webhooks when events occur.
type Dispatcher struct {
	db     *gorm.DB
	client *http.Client
}

func New(db *gorm.DB) *Dispatcher {
	return &Dispatcher{
		db:     db,
		client: &http.Client{Timeout: 5 * time.Second},
	}
}

// Dispatch fires all active webhooks subscribed to the given event (async).
func (d *Dispatcher) Dispatch(event string, payload interface{}) {
	var hooks []database.WebhookConfig
	if err := d.db.Where("active = ?", true).Find(&hooks).Error; err != nil {
		return
	}
	for _, h := range hooks {
		if !hasEvent(h.Events, event) {
			continue
		}
		go d.send(h, event, payload)
	}
}

func isDiscordURL(u string) bool {
	return strings.Contains(u, "discord.com/api/webhooks") ||
		strings.Contains(u, "discordapp.com/api/webhooks")
}

func discordColor(event string) int {
	switch event {
	case "account.exhausted":
		return 16744272 // orange
	case "account.error":
		return 15548997 // red
	default:
		return 3447003 // blue
	}
}

func marshalDiscordPayload(event string, payload interface{}) ([]byte, error) {
	desc, _ := json.Marshal(payload)
	return json.Marshal(map[string]interface{}{
		"embeds": []map[string]interface{}{{
			"title":       event,
			"description": "```json\n" + string(desc) + "\n```",
			"color":       discordColor(event),
			"timestamp":   time.Now().UTC().Format(time.RFC3339),
		}},
	})
}

func (d *Dispatcher) send(hook database.WebhookConfig, event string, payload interface{}) {
	var body []byte
	var err error

	if isDiscordURL(hook.URL) {
		body, err = marshalDiscordPayload(event, payload)
	} else {
		body, err = json.Marshal(map[string]interface{}{
			"event":     event,
			"timestamp": time.Now().UTC().Format(time.RFC3339),
			"data":      payload,
		})
	}
	if err != nil {
		return
	}

	req, err := http.NewRequest(http.MethodPost, hook.URL, bytes.NewReader(body))
	if err != nil {
		log.Printf("webhook: bad URL %s: %v", hook.URL, err)
		return
	}

	req.Header.Set("Content-Type", "application/json")

	if !isDiscordURL(hook.URL) {
		req.Header.Set("X-Event", event)
		req.Header.Set("X-Timestamp", time.Now().UTC().Format(time.RFC3339))
		if hook.Secret != "" {
			mac := hmac.New(sha256.New, []byte(hook.Secret))
			mac.Write(body)
			req.Header.Set("X-Signature", "sha256="+hex.EncodeToString(mac.Sum(nil)))
		}
	}

	resp, err := d.client.Do(req)
	if err != nil {
		log.Printf("webhook: delivery failed to %s (%s): %v", hook.URL, event, err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		log.Printf("webhook: %s responded %d for event %s", hook.URL, resp.StatusCode, event)
	}
}

func hasEvent(events, event string) bool {
	for _, e := range strings.Split(events, ",") {
		if strings.TrimSpace(e) == event {
			return true
		}
	}
	return false
}
