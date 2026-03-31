package quota

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strconv"
	"sync"
	"time"

	"claude-proxy/internal/crypto"
	"claude-proxy/internal/database"
	"claude-proxy/internal/settings"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const usageURL = "https://api.anthropic.com/api/oauth/usage"

// apiResponse matches the Anthropic usage API response.
type apiResponse struct {
	FiveHour       quotaWindow  `json:"five_hour"`
	SevenDay       quotaWindow  `json:"seven_day"`
	SevenDayOpus   *quotaWindow `json:"seven_day_opus"`
	SevenDaySonnet *quotaWindow `json:"seven_day_sonnet"`
	ExtraUsage     *extraUsage  `json:"extra_usage"`
}

type quotaWindow struct {
	Utilization float64 `json:"utilization"`
	ResetsAt    *string `json:"resets_at"`
}

type extraUsage struct {
	IsEnabled    bool     `json:"is_enabled"`
	MonthlyLimit *float64 `json:"monthly_limit"`
	UsedCredits  *float64 `json:"used_credits"`
}

// Poller periodically fetches Anthropic usage for all OAuth accounts.
type Poller struct {
	db              *gorm.DB
	enc             *crypto.Encryptor
	settings        *settings.Service
	client          *http.Client
	failCount       map[uint]int // consecutive failures per account
	failCountMu     sync.Mutex
	pollTimes       []time.Time  // timestamps of recent polls for global rate limit
	pollTimesMu     sync.Mutex
}

// New creates a quota poller.
func New(db *gorm.DB, enc *crypto.Encryptor, svc *settings.Service) *Poller {
	return &Poller{
		db:        db,
		enc:       enc,
		settings:  svc,
		client:    &http.Client{Timeout: 15 * time.Second},
		failCount: make(map[uint]int),
	}
}

// Start launches the background polling loop.
func (p *Poller) Start(ctx context.Context) {
	go func() {
		// Initial poll on startup
		p.pollAll()

		for {
			interval := p.getInterval()
			select {
			case <-ctx.Done():
				return
			case <-time.After(interval):
				p.pollAll()
			}
		}
	}()
	log.Println("quota: poller started")
}

func (p *Poller) getInterval() time.Duration {
	if p.settings != nil {
		if mins := p.settings.GetInt("quota_poll_interval"); mins > 0 {
			return time.Duration(mins) * time.Minute
		}
	}
	return 3 * time.Minute // default: 1 poll every 3 minutes
}

// globalRateLimitOK returns true if we haven't exceeded 6 polls in the last 10 minutes.
func (p *Poller) globalRateLimitOK() bool {
	p.pollTimesMu.Lock()
	defer p.pollTimesMu.Unlock()
	cutoff := time.Now().Add(-10 * time.Minute)
	// Prune old entries
	fresh := p.pollTimes[:0]
	for _, t := range p.pollTimes {
		if t.After(cutoff) {
			fresh = append(fresh, t)
		}
	}
	p.pollTimes = fresh
	return len(p.pollTimes) < 6
}

func (p *Poller) recordPoll() {
	p.pollTimesMu.Lock()
	p.pollTimes = append(p.pollTimes, time.Now())
	p.pollTimesMu.Unlock()
}

func (p *Poller) pollAll() {
	if !p.globalRateLimitOK() {
		log.Println("quota: skipping poll cycle — global rate limit (6/10min) reached")
		return
	}

	var accounts []database.ClaudeAccount
	p.db.Where("account_type = ?", "oauth").Find(&accounts)

	interval := p.getInterval()

	for _, acc := range accounts {
		// Skip accounts in backoff (failed too many times recently)
		p.failCountMu.Lock()
		fails := p.failCount[acc.ID]
		p.failCountMu.Unlock()
		if fails > 0 {
			// Exponential backoff: skip this cycle if backoff period not reached
			backoffCycles := int(math.Min(float64(fails), 5)) // max 2^5 = 32 cycles
			if fails > 0 && (fails%int(math.Pow(2, float64(backoffCycles-1)))) != 0 {
				continue // Skip this poll cycle for this account
			}
		}

		if !p.globalRateLimitOK() {
			break // stop this cycle if we hit the global limit mid-batch
		}
		p.recordPoll()
		if err := p.fetchOne(acc); err != nil {
			p.failCountMu.Lock()
			p.failCount[acc.ID]++
			count := p.failCount[acc.ID]
			p.failCountMu.Unlock()

			// Log only on first failure or every 10th consecutive failure
			if count == 1 || count%10 == 0 {
				log.Printf("quota: account %d (%s): %v (failures: %d, backoff: %s)", acc.ID, acc.Name, err, count, interval*time.Duration(int(math.Pow(2, math.Min(float64(count), 5)))))
			}

			// Store error but keep old data
			p.db.Clauses(clause.OnConflict{
				Columns:   []clause.Column{{Name: "account_id"}},
				DoUpdates: clause.AssignmentColumns([]string{"error", "updated_at"}),
			}).Create(&database.AccountQuota{
				AccountID: acc.ID,
				Error:     err.Error(),
				UpdatedAt: time.Now(),
			})
		} else {
			// Success: reset failure count
			p.failCountMu.Lock()
			delete(p.failCount, acc.ID)
			p.failCountMu.Unlock()
		}
	}
}

// PollNow triggers an immediate poll of all accounts (for manual refresh button).
func (p *Poller) PollNow() {
	// Reset all backoff counters
	p.failCountMu.Lock()
	p.failCount = make(map[uint]int)
	p.failCountMu.Unlock()
	go p.pollAll()
}

func (p *Poller) fetchOne(acc database.ClaudeAccount) error {
	token, err := p.enc.Decrypt(acc.AccessToken)
	if err != nil {
		return fmt.Errorf("decrypt: %w", err)
	}

	req, err := http.NewRequest("GET", usageURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("User-Agent", "claude-code/2.1.0")
	req.Header.Set("Anthropic-Beta", "oauth-2025-04-20")
	req.Header.Set("Accept", "application/json")

	resp, err := p.client.Do(req)
	if err != nil {
		return fmt.Errorf("fetch: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("read: %w", err)
	}

	if resp.StatusCode == http.StatusTooManyRequests {
		return fmt.Errorf("rate limited (429) — will back off")
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("API %d: %s", resp.StatusCode, string(body[:min(len(body), 200)]))
	}

	var data apiResponse
	if err := json.Unmarshal(body, &data); err != nil {
		return fmt.Errorf("parse: %w", err)
	}

	quota := database.AccountQuota{
		AccountID:      acc.ID,
		FiveHourPct:    clampPct(data.FiveHour.Utilization),
		FiveHourResets: ptrStr(data.FiveHour.ResetsAt),
		SevenDayPct:    clampPct(data.SevenDay.Utilization),
		SevenDayResets: ptrStr(data.SevenDay.ResetsAt),
		ExtraEnabled:   false,
		RawJSON:        string(body),
		Error:          "",
		UpdatedAt:      time.Now(),
	}

	if data.SevenDayOpus != nil {
		pct := clampPct(data.SevenDayOpus.Utilization)
		quota.OpusPct = &pct
		quota.OpusResets = ptrStr(data.SevenDayOpus.ResetsAt)
	}
	if data.SevenDaySonnet != nil {
		pct := clampPct(data.SevenDaySonnet.Utilization)
		quota.SonnetPct = &pct
		quota.SonnetResets = ptrStr(data.SevenDaySonnet.ResetsAt)
	}
	if data.ExtraUsage != nil {
		quota.ExtraEnabled = data.ExtraUsage.IsEnabled
		quota.ExtraLimit = data.ExtraUsage.MonthlyLimit
		quota.ExtraUsed = data.ExtraUsage.UsedCredits
	}

	// Upsert
	p.db.Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "account_id"}},
		DoUpdates: clause.AssignmentColumns([]string{
			"five_hour_pct", "five_hour_resets",
			"seven_day_pct", "seven_day_resets",
			"opus_pct", "opus_resets",
			"sonnet_pct", "sonnet_resets",
			"extra_enabled", "extra_limit", "extra_used",
			"raw_json", "error", "updated_at",
		}),
	}).Create(&quota)

	return nil
}

func clampPct(v float64) int {
	i := int(v)
	if i > 100 {
		return 100
	}
	return i
}

func ptrStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// FormatResetTime formats an ISO8601 reset time for display.
func FormatResetTime(resetTime string) string {
	t, err := time.Parse(time.RFC3339, resetTime)
	if err != nil {
		return resetTime
	}
	now := time.Now()
	diff := t.Sub(now)
	hours := int(diff.Hours())
	mins := int(diff.Minutes()) % 60

	if hours < 1 && diff > 0 {
		return strconv.Itoa(mins) + "m"
	}
	if hours < 5 && diff > 0 {
		return fmt.Sprintf("%dh %dm", hours, mins)
	}
	return t.Format("Mon 3:04 PM")
}
