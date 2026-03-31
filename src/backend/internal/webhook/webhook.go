package webhook

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"log"
	"math"
	"net/http"
	"strings"
	"time"

	"claude-proxy/internal/database"

	"gorm.io/gorm"
)

// Dispatcher sends HTTP webhooks when events occur.
type Dispatcher struct {
	db       *gorm.DB
	client   *http.Client
	sent     map[string]time.Time // dedup: event+target → last sent time
	sentMu   sync.Mutex
	cooldown time.Duration // minimum time between identical notifications
}

func New(db *gorm.DB) *Dispatcher {
	return &Dispatcher{
		db:       db,
		client:   &http.Client{Timeout: 5 * time.Second},
		sent:     make(map[string]time.Time),
		cooldown: 10 * time.Minute,
	}
}

// Dispatch fires all active webhooks subscribed to the given event (async).
// Deduplicates: same event+payload key is only sent once per cooldown period (10 min).
func (d *Dispatcher) Dispatch(event string, payload interface{}) {
	// Build dedup key from event + payload summary
	keyData, _ := json.Marshal(payload)
	dedupKey := event + ":" + string(keyData)

	d.sentMu.Lock()
	if last, ok := d.sent[dedupKey]; ok && time.Since(last) < d.cooldown {
		d.sentMu.Unlock()
		return // already sent recently, skip
	}
	d.sent[dedupKey] = time.Now()
	// Prune old entries
	for k, t := range d.sent {
		if time.Since(t) > d.cooldown {
			delete(d.sent, k)
		}
	}
	d.sentMu.Unlock()

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
	case "quota.warning":
		return 16776960 // yellow
	default:
		return 3447003 // blue
	}
}

func discordEmoji(event string) string {
	switch event {
	case "account.exhausted":
		return ":warning:"
	case "account.error":
		return ":x:"
	case "quota.warning":
		return ":chart_with_upwards_trend:"
	default:
		return ":bell:"
	}
}

func marshalDiscordPayload(event string, payload interface{}) ([]byte, error) {
	// Build human-readable fields from payload
	data, _ := json.Marshal(payload)
	var fields []map[string]interface{}
	var flat map[string]interface{}
	if json.Unmarshal(data, &flat) == nil {
		for k, v := range flat {
			fields = append(fields, map[string]interface{}{
				"name":   strings.ReplaceAll(k, "_", " "),
				"value":  fmt.Sprintf("`%v`", v),
				"inline": true,
			})
		}
	}

	embed := map[string]interface{}{
		"title":     fmt.Sprintf("%s  %s", discordEmoji(event), event),
		"color":     discordColor(event),
		"timestamp": time.Now().UTC().Format(time.RFC3339),
		"footer":    map[string]string{"text": "OurClaude"},
	}
	if len(fields) > 0 {
		embed["fields"] = fields
	}

	return json.Marshal(map[string]interface{}{
		"embeds": []map[string]interface{}{embed},
	})
}

func (d *Dispatcher) send(hook database.WebhookConfig, event string, payload interface{}) {
	var body []byte
	var err error

	if isDiscordURL(hook.URL) {
		body, err = marshalDiscordPayload(event, payload)
	} else if strings.Contains(hook.URL, "hooks.slack.com") {
		detailsJSON, _ := json.Marshal(payload)
		target := event
		slackPayload := map[string]interface{}{
			"text": fmt.Sprintf("*[%s]* %s\n```%s```", event, target, detailsJSON),
		}
		body, err = json.Marshal(slackPayload)
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

	const maxRetries = 3
	for attempt := 0; attempt < maxRetries; attempt++ {
		resp, err := d.client.Do(req)
		if err == nil && resp.StatusCode < 400 {
			resp.Body.Close()
			return
		}
		if resp != nil {
			resp.Body.Close()
		}
		if attempt < maxRetries-1 {
			backoff := time.Duration(math.Pow(2, float64(attempt))) * time.Second
			time.Sleep(backoff)
			// Rebuild request for retry
			req, _ = http.NewRequest("POST", hook.URL, bytes.NewReader(body))
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
		}
	}
	log.Printf("webhook: permanently failed after %d retries: %s (%s)", maxRetries, hook.URL, event)
}

func hasEvent(events, event string) bool {
	for _, e := range strings.Split(events, ",") {
		if strings.TrimSpace(e) == event {
			return true
		}
	}
	return false
}
