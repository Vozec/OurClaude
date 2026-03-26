package pool

import (
	"context"
	"errors"
	"log"
	"net/http"
	"sort"
	"sync"
	"time"

	"claude-proxy/internal/crypto"
	"claude-proxy/internal/database"
	"claude-proxy/internal/oauth"
	"claude-proxy/internal/webhook"

	"gorm.io/gorm"
)

var ErrNoActiveAccounts = errors.New("no active accounts available in pool")

// WebhookDispatcher is a subset of webhook.Dispatcher to avoid tight coupling.
type WebhookDispatcher interface {
	Dispatch(event string, payload interface{})
}

type Manager struct {
	db         *gorm.DB
	oauth      *oauth.Refresher
	enc        *crypto.Encryptor
	webhooks   WebhookDispatcher // may be nil
	mu         sync.Mutex
	roundRobin map[uint]int
}

func New(db *gorm.DB, oauthRefresher *oauth.Refresher, enc *crypto.Encryptor, webhooks *webhook.Dispatcher) *Manager {
	return &Manager{
		db:         db,
		oauth:      oauthRefresher,
		enc:        enc,
		webhooks:   webhooks,
		roundRobin: make(map[uint]int),
	}
}

// StartHealthCheck periodically tests every account and marks unhealthy ones.
// It performs a lightweight HEAD/GET to the upstream to verify token validity.
func (m *Manager) StartHealthCheck(ctx context.Context, interval time.Duration, upstreamURL string) {
	if interval <= 0 {
		return
	}
	go func() {
		log.Printf("pool: health-check enabled (interval: %s)", interval)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				var accounts []database.ClaudeAccount
				if err := m.db.Where("status = ?", "active").Find(&accounts).Error; err != nil {
					log.Printf("pool health-check: failed to list accounts: %v", err)
					continue
				}
				for _, acc := range accounts {
					if err := m.decryptAccount(&acc); err != nil {
						continue
					}
					// Test by calling the models list endpoint — cheap, no tokens consumed.
					req, err := http.NewRequestWithContext(ctx, http.MethodGet, upstreamURL+"/v1/models", nil)
					if err != nil {
						continue
					}
					req.Header.Set("Authorization", "Bearer "+acc.AccessToken)
					client := &http.Client{Timeout: 10 * time.Second}
					resp, err := client.Do(req)
					if err != nil {
						m.MarkError(acc.ID, "health-check: "+err.Error())
						log.Printf("pool health-check: account %d error: %v", acc.ID, err)
						continue
					}
					resp.Body.Close()
					if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
						m.MarkError(acc.ID, "health-check: token invalid ("+http.StatusText(resp.StatusCode)+")")
						log.Printf("pool health-check: account %d invalid token (%d)", acc.ID, resp.StatusCode)
					} else if resp.StatusCode >= 500 || resp.StatusCode == http.StatusTooManyRequests {
						log.Printf("pool health-check: account %d temporary error (%d)", acc.ID, resp.StatusCode)
					}
				}
			}
		}
	}()
}

// StartAutoReset launches a background goroutine that resets exhausted accounts
// in all pools every `interval`. Stops when ctx is cancelled.
func (m *Manager) StartAutoReset(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		return
	}
	go func() {
		log.Printf("pool: auto-reset enabled (interval: %s)", interval)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				var pools []database.Pool
				if err := m.db.Find(&pools).Error; err != nil {
					log.Printf("pool auto-reset: failed to list pools: %v", err)
					continue
				}
				for _, p := range pools {
					if err := m.ResetPool(p.ID); err != nil {
						log.Printf("pool auto-reset: failed to reset pool %d: %v", p.ID, err)
					}
				}
				log.Printf("pool: auto-reset complete (%d pools)", len(pools))
			}
		}
	}()
}

// GetAccountForUser selects the best account across multiple pools.
// It picks the pool with the lowest total token usage today, then applies
// round-robin within that pool. Falls back to single-pool behaviour if only
// one pool is provided.
func (m *Manager) GetAccountForUser(poolIDs []uint) (*database.ClaudeAccount, error) {
	if len(poolIDs) == 0 {
		return nil, ErrNoActiveAccounts
	}
	if len(poolIDs) == 1 {
		return m.GetAccountForPool(poolIDs[0])
	}

	today := time.Now().UTC().Truncate(24 * time.Hour)
	bestPoolID := poolIDs[0]
	var minUsage int64 = -1

	for _, pid := range poolIDs {
		var usage int64
		m.db.Model(&database.UsageLog{}).
			Joins("JOIN claude_accounts ON usage_logs.account_id = claude_accounts.id").
			Joins("JOIN account_pools ON account_pools.account_id = claude_accounts.id").
			Where("account_pools.pool_id = ? AND usage_logs.created_at >= ?", pid, today).
			Select("COALESCE(SUM(usage_logs.input_tokens + usage_logs.output_tokens), 0)").
			Row().Scan(&usage)
		if minUsage < 0 || usage < minUsage {
			minUsage = usage
			bestPoolID = pid
		}
	}

	return m.GetAccountForPool(bestPoolID)
}

// GetAccountForPool returns the next active account for the given pool.
// Priority: active OAuth → active API keys (fallback) → exhausted OAuth (last resort).
func (m *Manager) GetAccountForPool(poolID uint) (*database.ClaudeAccount, error) {
	var accounts []database.ClaudeAccount
	if err := m.db.Joins("JOIN account_pools ON account_pools.account_id = claude_accounts.id").
		Where("account_pools.pool_id = ? AND claude_accounts.status != ?", poolID, "error").
		Find(&accounts).Error; err != nil {
		return nil, err
	}

	// 1. Try active OAuth accounts first (scored pick: drain mode / reset-aware)
	oauthActive := filterByTypeAndStatus(accounts, "oauth", "active")
	if len(oauthActive) > 0 {
		return m.scoredPick(oauthActive)
	}

	// 2. Fallback: try enabled API keys
	apikeys := filterByTypeAndStatus(accounts, "apikey", "active")
	if len(apikeys) > 0 {
		return m.pickAndValidate(poolID, apikeys)
	}

	// 3. Last resort: exhausted OAuth accounts (don't mark error on failure)
	oauthExhausted := filterByTypeAndStatus(accounts, "oauth", "exhausted")
	if len(oauthExhausted) > 0 {
		return m.pickAndValidateSoft(poolID, oauthExhausted)
	}

	// 4. Final fallback: error OAuth accounts (try to recover)
	var errorAccounts []database.ClaudeAccount
	m.db.Joins("JOIN account_pools ON account_pools.account_id = claude_accounts.id").
		Where("account_pools.pool_id = ? AND claude_accounts.status = ? AND claude_accounts.account_type = ?", poolID, "error", "oauth").
		Find(&errorAccounts)
	if len(errorAccounts) > 0 {
		return m.pickAndValidateSoft(poolID, errorAccounts)
	}

	return nil, ErrNoActiveAccounts
}

func (m *Manager) pickAndValidate(poolID uint, candidates []database.ClaudeAccount) (*database.ClaudeAccount, error) {
	m.mu.Lock()
	idx := m.roundRobin[poolID] % len(candidates)
	m.roundRobin[poolID] = (idx + 1) % len(candidates)
	account := candidates[idx]
	m.mu.Unlock()

	if err := m.decryptAccount(&account); err != nil {
		return nil, err
	}

	// Skip token refresh for API keys
	if account.AccountType != "apikey" {
		if err := m.oauth.EnsureValid(m.db, &account); err != nil {
			m.MarkError(account.ID, err.Error())
			return nil, err
		}
	}

	return &account, nil
}

// pickAndValidateSoft is like pickAndValidate but doesn't mark accounts as error on failure.
// Used for last-resort exhausted accounts to avoid permanently locking out the only account.
func (m *Manager) pickAndValidateSoft(poolID uint, candidates []database.ClaudeAccount) (*database.ClaudeAccount, error) {
	m.mu.Lock()
	idx := m.roundRobin[poolID] % len(candidates)
	m.roundRobin[poolID] = (idx + 1) % len(candidates)
	account := candidates[idx]
	m.mu.Unlock()

	if err := m.decryptAccount(&account); err != nil {
		return nil, err
	}

	if account.AccountType != "apikey" {
		if err := m.oauth.EnsureValid(m.db, &account); err != nil {
			// Don't mark error — just log and return the account as-is
			// It might still work with an expired token for some endpoints
			log.Printf("pool: soft validation failed for account %d, using anyway: %v", account.ID, err)
		}
	}

	return &account, nil
}

// scoredPick selects the best OAuth account based on quota data.
// Accounts closer to their 5-hour reset window with usage below 95% are
// prioritised so their remaining capacity is drained before the reset.
func (m *Manager) scoredPick(candidates []database.ClaudeAccount) (*database.ClaudeAccount, error) {
	type scored struct {
		account database.ClaudeAccount
		score   float64
	}

	var items []scored
	for _, acc := range candidates {
		var q database.AccountQuota
		score := 50.0 // default if no quota data
		if m.db.Where("account_id = ?", acc.ID).First(&q).Error == nil {
			score = float64(q.FiveHourPct)
			// Drain mode: if reset is imminent and usage below 95%, prioritize it
			if q.FiveHourResets != "" {
				if t, err := time.Parse(time.RFC3339, q.FiveHourResets); err == nil {
					minutesUntilReset := time.Until(t).Minutes()
					if minutesUntilReset > 0 && minutesUntilReset < 30 && q.FiveHourPct < 95 {
						score *= 0.2 // Heavy bonus — drain this account first
					} else if minutesUntilReset > 0 && minutesUntilReset < 60 {
						score *= 0.5 // Moderate bonus
					}
				}
			}
		}
		items = append(items, scored{account: acc, score: score})
	}

	// Sort by score ascending (lowest = best candidate)
	sort.Slice(items, func(i, j int) bool { return items[i].score < items[j].score })

	// Try candidates in order until one validates successfully
	for _, item := range items {
		account := item.account
		if err := m.decryptAccount(&account); err != nil {
			continue
		}
		if err := m.oauth.EnsureValid(m.db, &account); err != nil {
			m.MarkError(account.ID, err.Error())
			continue
		}
		return &account, nil
	}

	return nil, ErrNoActiveAccounts
}

func (m *Manager) MarkExhausted(accountID uint) {
	m.db.Model(&database.ClaudeAccount{}).
		Where("id = ?", accountID).
		Updates(map[string]interface{}{"status": "exhausted"})

	if m.webhooks != nil {
		m.webhooks.Dispatch("account.exhausted", map[string]interface{}{
			"account_id": accountID,
		})
	}
}

func (m *Manager) MarkError(accountID uint, errMsg string) {
	m.db.Model(&database.ClaudeAccount{}).
		Where("id = ?", accountID).
		Updates(map[string]interface{}{
			"status":     "error",
			"last_error": errMsg,
		})

	if m.webhooks != nil {
		m.webhooks.Dispatch("account.error", map[string]interface{}{
			"account_id": accountID,
			"error":      errMsg,
		})
	}
}

func (m *Manager) ResetPool(poolID uint) error {
	return m.db.Model(&database.ClaudeAccount{}).
		Where("id IN (SELECT account_id FROM account_pools WHERE pool_id = ?) AND status = ?", poolID, "exhausted").
		Updates(map[string]interface{}{
			"status":     "active",
			"last_error": "",
		}).Error
}

func (m *Manager) ResetAccount(accountID uint) error {
	return m.db.Model(&database.ClaudeAccount{}).
		Where("id = ?", accountID).
		Updates(map[string]interface{}{
			"status":     "active",
			"last_error": "",
		}).Error
}

func (m *Manager) UpdateLastUsed(accountID uint) {
	now := time.Now()
	m.db.Model(&database.ClaudeAccount{}).
		Where("id = ?", accountID).
		Update("last_used_at", now)
}

func (m *Manager) decryptAccount(account *database.ClaudeAccount) error {
	access, err := m.enc.Decrypt(account.AccessToken)
	if err != nil {
		return err
	}
	refresh, err := m.enc.Decrypt(account.RefreshToken)
	if err != nil {
		return err
	}
	account.AccessToken = access
	account.RefreshToken = refresh
	return nil
}

func filterByStatus(accounts []database.ClaudeAccount, status string) []database.ClaudeAccount {
	var result []database.ClaudeAccount
	for _, a := range accounts {
		if a.Status == status {
			result = append(result, a)
		}
	}
	return result
}

func filterByTypeAndStatus(accounts []database.ClaudeAccount, accountType, status string) []database.ClaudeAccount {
	var result []database.ClaudeAccount
	for _, a := range accounts {
		t := a.AccountType
		if t == "" {
			t = "oauth"
		}
		if t == accountType && a.Status == status {
			result = append(result, a)
		}
	}
	return result
}
