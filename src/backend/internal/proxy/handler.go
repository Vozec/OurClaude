package proxy

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"claude-proxy/internal/database"
	"claude-proxy/internal/metrics"
	"claude-proxy/internal/pool"
	"claude-proxy/internal/ratelimit"
	"claude-proxy/internal/sse"

	"gorm.io/gorm"
)

// WebhookDispatcher abstracts webhook.Dispatcher to avoid tight coupling.
type WebhookDispatcher interface {
	Dispatch(event string, payload interface{})
}

var errUnauthorized = errors.New("unauthorized")

// quotaAlertState tracks the last time a quota alert was sent per user to debounce.
type quotaAlertState struct {
	mu       sync.Mutex
	lastSent map[uint]time.Time
}

func (q *quotaAlertState) shouldAlert(userID uint) bool {
	q.mu.Lock()
	defer q.mu.Unlock()
	if t, ok := q.lastSent[userID]; ok && time.Since(t) < time.Hour {
		return false
	}
	q.lastSent[userID] = time.Now()
	return true
}

// aliasCache caches model aliases from the DB to avoid per-request queries.
type aliasCache struct {
	mu        sync.RWMutex
	data      map[string]string
	updatedAt time.Time
}

func (c *aliasCache) get(db *gorm.DB, model string) string {
	c.mu.RLock()
	stale := time.Since(c.updatedAt) > 5*time.Second
	if !stale {
		if target, ok := c.data[model]; ok {
			c.mu.RUnlock()
			return target
		}
		c.mu.RUnlock()
		return model
	}
	c.mu.RUnlock()

	c.mu.Lock()
	defer c.mu.Unlock()
	// Double-check after acquiring write lock.
	if time.Since(c.updatedAt) <= 5*time.Second {
		if target, ok := c.data[model]; ok {
			return target
		}
		return model
	}
	var aliases []database.ModelAlias
	if err := db.Find(&aliases).Error; err != nil {
		log.Printf("proxy: failed to refresh alias cache: %v", err)
	}
	c.data = make(map[string]string, len(aliases))
	for _, a := range aliases {
		c.data[a.Alias] = a.Target
	}
	c.updatedAt = time.Now()
	if target, ok := c.data[model]; ok {
		return target
	}
	return model
}

type quotaCacheEntry struct {
	dailyUsed, monthlyUsed int64
	budgetSpent            float64
	poolDailyUsed          map[uint]int64
	poolMonthlyUsed        map[uint]int64
	expiresAt              time.Time
}

type quotaCache struct {
	mu    sync.RWMutex
	cache map[uint]*quotaCacheEntry // keyed by user ID
}

func (c *quotaCache) get(userID uint) *quotaCacheEntry {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if e, ok := c.cache[userID]; ok && time.Now().Before(e.expiresAt) {
		return e
	}
	return nil
}

func (c *quotaCache) set(userID uint, entry *quotaCacheEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry.expiresAt = time.Now().Add(10 * time.Second)
	c.cache[userID] = entry
}

type Handler struct {
	db          *gorm.DB
	pool        *pool.Manager
	upstream    string
	client      *http.Client
	limiter     ratelimit.Limiter
	settings    SettingsProvider
	webhooks    WebhookDispatcher
	logStream   *sse.Broadcaster
	statsStream *sse.Broadcaster
	quotaAlerts quotaAlertState
	aliases     aliasCache
	quotas      quotaCache
	respCache   *responseCache
	inflight    sync.Map // map[string]struct{} for in-flight idempotency keys
}

// SettingsProvider reads runtime settings (backed by DB).
type SettingsProvider interface {
	Get(key string) string
	GetBool(key string) bool
	GetInt(key string) int
}

func New(db *gorm.DB, poolMgr *pool.Manager, upstream string, redisURL string, settings SettingsProvider, wh WebhookDispatcher, logStream *sse.Broadcaster, statsStream *sse.Broadcaster) *Handler {
	rpm := 0
	if settings != nil {
		rpm = settings.GetInt("user_max_rpm")
	}
	return &Handler{
		db:          db,
		pool:        poolMgr,
		upstream:    strings.TrimRight(upstream, "/"),
		limiter:     ratelimit.New(rpm, redisURL),
		settings:    settings,
		webhooks:    wh,
		logStream:   logStream,
		statsStream: statsStream,
		quotaAlerts: quotaAlertState{lastSent: make(map[uint]time.Time)},
		aliases:     aliasCache{data: make(map[string]string)},
		quotas:      quotaCache{cache: make(map[uint]*quotaCacheEntry)},
		respCache:   newResponseCache(0), // TTL read from settings per-request
		client: &http.Client{
			Timeout: 5 * time.Minute,
			CheckRedirect: func(req *http.Request, via []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	user, err := h.authenticate(r)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized — check your API token with 'ourclaude status' or re-login with 'ourclaude login'")
		return
	}

	if !user.Active {
		writeError(w, http.StatusForbidden, "account disabled")
		return
	}

	// Token expiry
	if user.TokenExpiresAt != nil && time.Now().After(*user.TokenExpiresAt) {
		writeError(w, http.StatusUnauthorized, "token expired")
		return
	}

	// IP whitelist
	if user.IPWhitelist != "" {
		if !ipAllowed(r, user.IPWhitelist) {
			writeError(w, http.StatusForbidden, "IP not allowed")
			return
		}
	}

	// Idempotency-Key deduplication: reject duplicate in-flight requests
	if key := r.Header.Get("Idempotency-Key"); key != "" {
		if _, loaded := h.inflight.LoadOrStore(key, struct{}{}); loaded {
			writeError(w, http.StatusConflict, "duplicate request in progress")
			return
		}
		defer h.inflight.Delete(key)
	}

	if !h.limiter.Allow(user.ID) {
		writeError(w, http.StatusTooManyRequests, "rate limit exceeded")
		return
	}

	// Load all pool IDs for this user from user_pools join table
	var poolIDs []uint
	if err := h.db.Table("user_pools").Where("user_id = ?", user.ID).Pluck("pool_id", &poolIDs).Error; err != nil {
		log.Printf("proxy: failed to load user pool IDs (user=%d): %v", user.ID, err)
	}

	if len(poolIDs) == 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusServiceUnavailable)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"type": "error",
			"error": map[string]string{
				"type":    "api_error",
				"message": "No pool linked to your account. Ask an administrator to assign you to a pool.",
			},
		})
		return
	}

	// Quota checks with cache
	cached := h.quotas.get(user.ID)
	if cached == nil {
		now := time.Now().UTC()
		today := now.Truncate(24 * time.Hour)
		monthStart := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)

		var dailyUsed int64
		h.db.Model(&database.UsageLog{}).
			Where("user_id = ? AND created_at >= ?", user.ID, today).
			Select("COALESCE(SUM(input_tokens + output_tokens), 0)").
			Row().Scan(&dailyUsed)

		var monthlyUsed int64
		h.db.Model(&database.UsageLog{}).
			Where("user_id = ? AND created_at >= ?", user.ID, monthStart).
			Select("COALESCE(SUM(input_tokens + output_tokens), 0)").
			Row().Scan(&monthlyUsed)

		budgetSpent := estimateMonthlyCost(h.db, user.ID, monthStart)

		poolDailyUsed := make(map[uint]int64)
		poolMonthlyUsed := make(map[uint]int64)
		firstPoolID := poolIDs[0]
		var poolRec database.Pool
		if h.db.First(&poolRec, firstPoolID).Error == nil {
			if poolRec.DailyTokenQuota > 0 {
				var used int64
				h.db.Model(&database.UsageLog{}).
					Joins("JOIN claude_accounts ON usage_logs.account_id = claude_accounts.id").
					Joins("JOIN account_pools ON account_pools.account_id = claude_accounts.id").
					Where("account_pools.pool_id = ? AND usage_logs.created_at >= ?", firstPoolID, today).
					Select("COALESCE(SUM(usage_logs.input_tokens + usage_logs.output_tokens), 0)").
					Row().Scan(&used)
				poolDailyUsed[firstPoolID] = used
			}
			if poolRec.MonthlyTokenQuota > 0 {
				var used int64
				h.db.Model(&database.UsageLog{}).
					Joins("JOIN claude_accounts ON usage_logs.account_id = claude_accounts.id").
					Joins("JOIN account_pools ON account_pools.account_id = claude_accounts.id").
					Where("account_pools.pool_id = ? AND usage_logs.created_at >= ?", firstPoolID, monthStart).
					Select("COALESCE(SUM(usage_logs.input_tokens + usage_logs.output_tokens), 0)").
					Row().Scan(&used)
				poolMonthlyUsed[firstPoolID] = used
			}
		}

		cached = &quotaCacheEntry{
			dailyUsed:       dailyUsed,
			monthlyUsed:     monthlyUsed,
			budgetSpent:     budgetSpent,
			poolDailyUsed:   poolDailyUsed,
			poolMonthlyUsed: poolMonthlyUsed,
		}
		h.quotas.set(user.ID, cached)
	}

	// Daily token quota
	if user.DailyTokenQuota > 0 {
		if int(cached.dailyUsed) >= user.DailyTokenQuota {
			writeError(w, http.StatusTooManyRequests, "daily token quota exceeded")
			return
		}
		h.maybeAlertQuota(user, "daily", int(cached.dailyUsed), user.DailyTokenQuota)
	}

	// Monthly token quota
	if user.MonthlyTokenQuota > 0 {
		if int(cached.monthlyUsed) >= user.MonthlyTokenQuota {
			writeError(w, http.StatusTooManyRequests, "monthly token quota exceeded")
			return
		}
		h.maybeAlertQuota(user, "monthly", int(cached.monthlyUsed), user.MonthlyTokenQuota)
	}

	// Monthly budget (USD)
	if user.MonthlyBudgetUSD > 0 {
		if cached.budgetSpent >= user.MonthlyBudgetUSD {
			writeError(w, http.StatusTooManyRequests, fmt.Sprintf("monthly budget of $%.2f exceeded", user.MonthlyBudgetUSD))
			return
		}
	}

	// Per-pool quotas (check first assigned pool for now)
	firstPoolID := poolIDs[0]
	var poolRecord database.Pool
	if h.db.First(&poolRecord, firstPoolID).Error == nil {
		if poolRecord.DailyTokenQuota > 0 {
			if int(cached.poolDailyUsed[firstPoolID]) >= poolRecord.DailyTokenQuota {
				writeError(w, http.StatusTooManyRequests, "pool daily token quota exceeded")
				return
			}
		}
		if poolRecord.MonthlyTokenQuota > 0 {
			if int(cached.poolMonthlyUsed[firstPoolID]) >= poolRecord.MonthlyTokenQuota {
				writeError(w, http.StatusTooManyRequests, "pool monthly token quota exceeded")
				return
			}
		}
	}

	r.Body = http.MaxBytesReader(w, r.Body, 50*1024*1024) // 50MB limit
	body, err := io.ReadAll(r.Body)
	if err != nil {
		if err.Error() == "http: request body too large" {
			writeError(w, http.StatusRequestEntityTooLarge, "request body too large (max 50MB)")
		} else {
			writeError(w, http.StatusBadRequest, "failed to read request body")
		}
		return
	}
	r.Body.Close()

	// Extract messages for conversation logging (before alias rewriting)
	var reqParsed struct {
		Messages json.RawMessage `json:"messages"`
	}
	if err := json.Unmarshal(body, &reqParsed); err != nil {
		log.Printf("proxy: failed to parse request body for conversation logging: %v", err)
	}
	messagesJSON := string(reqParsed.Messages)

	// System prompt injection (runtime-editable via settings)
	if sp := h.settings.Get("system_prompt_inject"); sp != "" {
		body = injectSystemPrompt(body, sp)
	}

	// Model alias rewriting
	body = rewriteModel(body, func(model string) string {
		return h.aliases.get(h.db, model)
	})

	// Model allowlist check (after alias resolution)
	if user.AllowedModels != "" {
		if !modelAllowed(body, user.AllowedModels) {
			writeError(w, http.StatusForbidden, "model not allowed for your account")
			return
		}
	}

	// Pool-level model restriction
	if poolRecord.AllowedModels != "" {
		if !modelAllowed(body, poolRecord.AllowedModels) {
			writeError(w, http.StatusForbidden, "model not allowed in this pool")
			return
		}
	}

	// Prompt cache injection
	if h.settings.GetBool("prompt_cache_inject") {
		body = injectPromptCache(body)
	}

	// Response cache check
	var cacheKey string
	if h.settings.GetInt("response_cache_ttl") > 0 {
		cacheKey = h.respCache.key(user.ID, body)
		if cached := h.respCache.get(cacheKey); cached != nil {
			for k, vs := range cached.headers {
				for _, v := range vs {
					w.Header().Add(k, v)
				}
			}
			w.Header().Set("X-Cache", "HIT")
			w.WriteHeader(cached.statusCode)
			w.Write(cached.body)
			return
		}
	}

	const maxRetries = 3
	var lastErr error

	for attempt := 0; attempt < maxRetries; attempt++ {
		account, err := h.pool.GetAccountForUser(poolIDs)
		if err != nil {
			writeError(w, http.StatusServiceUnavailable, "no available Claude accounts: "+err.Error())
			return
		}

		resp, err := h.forward(r, body, account.AccessToken, user)
		if err != nil {
			lastErr = err
			h.pool.MarkError(account.ID, err.Error())
			continue
		}

		if resp.StatusCode == http.StatusTooManyRequests {
			resp.Body.Close()
			h.pool.MarkExhausted(account.ID)
			lastErr = nil
			continue
		}

		h.streamResponse(w, resp, user.ID, account.ID, r.URL.Path, start, messagesJSON, cacheKey, h.logStream, h.statsStream)
		h.pool.UpdateLastUsed(account.ID)
		return
	}

	if lastErr != nil {
		writeError(w, http.StatusBadGateway, "upstream error: "+lastErr.Error())
	} else {
		writeError(w, http.StatusServiceUnavailable, "all accounts exhausted, try again later")
	}
}

func (h *Handler) authenticate(r *http.Request) (*database.User, error) {
	var token string

	// Try all auth header patterns (Claude Code may use any of these)
	if key := r.Header.Get("x-api-key"); key != "" {
		token = key
	} else if key := r.Header.Get("X-Api-Key"); key != "" {
		token = key
	} else if authHeader := r.Header.Get("Authorization"); authHeader != "" {
		// Try "Bearer TOKEN" format
		if t := strings.TrimPrefix(authHeader, "Bearer "); t != authHeader {
			token = t
		} else if t := strings.TrimPrefix(authHeader, "bearer "); t != authHeader {
			token = t
		}
	}

	// Also check anthropic-auth-token header (some clients send it this way)
	if token == "" {
		if key := r.Header.Get("Anthropic-Auth-Token"); key != "" {
			token = key
		}
	}

	if token == "" {
		log.Printf("proxy auth: no token found in request headers (x-api-key=%q, Authorization=%q)",
			r.Header.Get("x-api-key"), r.Header.Get("Authorization"))
		return nil, errUnauthorized
	}

	var user database.User
	if err := h.db.Where("api_token = ?", token).First(&user).Error; err != nil {
		log.Printf("proxy auth: token not found in DB (prefix=%s...)", token[:min(len(token), 15)])
		return nil, errUnauthorized
	}

	return &user, nil
}

func (h *Handler) forward(r *http.Request, body []byte, accessToken string, user *database.User) (*http.Response, error) {
	// Safety: strip /proxy prefix if chi Mount didn't strip it
	path := r.URL.Path
	if strings.HasPrefix(path, "/proxy") {
		path = strings.TrimPrefix(path, "/proxy")
	}
	if path == "" {
		path = "/"
	}
	upstreamURL := h.upstream + path
	if r.URL.RawQuery != "" {
		upstreamURL += "?" + r.URL.RawQuery
	}

	req, err := http.NewRequestWithContext(r.Context(), r.Method, upstreamURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}

	for key, values := range r.Header {
		k := strings.ToLower(key)
		if k == "authorization" || k == "host" || k == "x-api-key" {
			continue
		}
		for _, v := range values {
			req.Header.Add(key, v)
		}
	}

	req.Header.Set("Authorization", "Bearer "+accessToken)

	// OAuth tokens (sk-ant-oat*) require specific headers for Anthropic to accept them.
	if strings.HasPrefix(accessToken, "sk-ant-oat") {
		req.Header.Set("Anthropic-Dangerous-Direct-Browser-Access", "true")
		existing := req.Header.Get("Anthropic-Beta")
		if !strings.Contains(existing, "oauth-2025-04-20") {
			if existing != "" {
				req.Header.Set("Anthropic-Beta", "oauth-2025-04-20,"+existing)
			} else {
				req.Header.Set("Anthropic-Beta", "oauth-2025-04-20")
			}
		}
	}

	// Extra headers from user config (JSON map)
	if user != nil && user.ExtraHeaders != "" {
		var extra map[string]string
		if err := json.Unmarshal([]byte(user.ExtraHeaders), &extra); err == nil {
			for k, v := range extra {
				req.Header.Set(k, v)
			}
		}
	}

	// Ensure prompt-caching beta is declared when cache injection is active.
	if h.settings.GetBool("prompt_cache_inject") {
		existing := req.Header.Get("anthropic-beta")
		if !strings.Contains(existing, "prompt-caching") {
			if existing != "" {
				req.Header.Set("anthropic-beta", existing+",prompt-caching-2024-07-31")
			} else {
				req.Header.Set("anthropic-beta", "prompt-caching-2024-07-31")
			}
		}
	}

	return h.client.Do(req)
}

func (h *Handler) streamResponse(w http.ResponseWriter, resp *http.Response, userID, accountID uint, endpoint string, start time.Time, messagesJSON string, cacheKey string, logStream *sse.Broadcaster, statsStream *sse.Broadcaster) {
	defer resp.Body.Close()

	for key, values := range resp.Header {
		for _, v := range values {
			w.Header().Add(key, v)
		}
	}
	w.WriteHeader(resp.StatusCode)

	flusher, canFlush := w.(http.Flusher)
	isStreaming := strings.Contains(resp.Header.Get("Content-Type"), "text/event-stream")

	const maxCapture = 10 * 1024 * 1024 // 10MB
	var buf bytes.Buffer
	limitedBuf := &limitedWriter{w: &buf, limit: maxCapture}
	tee := io.TeeReader(resp.Body, limitedBuf)

	var ttftMs int
	firstByte := true
	chunk := make([]byte, 4096)
	for {
		n, err := tee.Read(chunk)
		if n > 0 {
			if firstByte && isStreaming {
				ttftMs = int(time.Since(start).Milliseconds())
				firstByte = false
			}
			w.Write(chunk[:n])
			if canFlush {
				flusher.Flush()
			}
		}
		if err != nil {
			break
		}
	}

	latencyMs := int(time.Since(start).Milliseconds())
	captured := buf.Bytes()

	// Debug: log captured body size and streaming status
	log.Printf("proxy: response captured %d bytes, streaming=%v, status=%d, user=%d, account=%d",
		len(captured), isStreaming, resp.StatusCode, userID, accountID)

	// Cache non-streaming successful responses
	if !isStreaming && resp.StatusCode == http.StatusOK && cacheKey != "" && h.settings.GetInt("response_cache_ttl") > 0 {
		headers := make(map[string][]string)
		for k, v := range resp.Header {
			headers[k] = v
		}
		cachedBody := make([]byte, len(captured))
		copy(cachedBody, captured)
		cacheTTL := time.Duration(h.settings.GetInt("response_cache_ttl")) * time.Second
		h.respCache.setWithTTL(cacheKey, &cachedResponse{
			statusCode: resp.StatusCode,
			headers:    headers,
			body:       cachedBody,
		}, cacheTTL)
	}

	go parseAndLogUsage(captured, isStreaming, userID, accountID, endpoint, resp.StatusCode, latencyMs, ttftMs, messagesJSON, h.db, logStream, statsStream)
}

func (h *Handler) maybeAlertQuota(user *database.User, period string, used, quota int) {
	pct := float64(used) / float64(quota)
	if pct < 0.8 {
		return
	}
	if !h.quotaAlerts.shouldAlert(user.ID) {
		return
	}
	if h.webhooks == nil {
		return
	}
	h.webhooks.Dispatch("quota.warning", map[string]interface{}{
		"user_id": user.ID,
		"period":  period,
		"used":       used,
		"quota":      quota,
		"percent":    int(pct * 100),
	})
}

func parseAndLogUsage(body []byte, isStreaming bool, userID, accountID uint, endpoint string, statusCode, latencyMs, ttftMs int, messagesJSON string, db *gorm.DB, logStream *sse.Broadcaster, statsStream *sse.Broadcaster) {
	var inputTokens, outputTokens, cacheRead, cacheWrite int
	var model string
	var responseText strings.Builder

	if len(body) == 0 {
		log.Printf("proxy: empty response body for user=%d account=%d status=%d", userID, accountID, statusCode)
	}

	if isStreaming {
		lines := bytes.Split(body, []byte("\n"))
		for _, line := range lines {
			if !bytes.HasPrefix(line, []byte("data: ")) {
				continue
			}
			data := line[6:]
			if string(data) == "[DONE]" {
				continue
			}

			var event struct {
				Type    string `json:"type"`
				Message struct {
					Model string `json:"model"`
					Usage struct {
						InputTokens              int `json:"input_tokens"`
						CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
						CacheReadInputTokens     int `json:"cache_read_input_tokens"`
					} `json:"usage"`
				} `json:"message"`
				Usage struct {
					OutputTokens int `json:"output_tokens"`
				} `json:"usage"`
				Delta struct {
					Type string `json:"type"`
					Text string `json:"text"`
				} `json:"delta"`
			}
			if err := json.Unmarshal(data, &event); err != nil {
				continue
			}
			switch event.Type {
			case "message_start":
				model = event.Message.Model
				inputTokens = event.Message.Usage.InputTokens
				cacheWrite = event.Message.Usage.CacheCreationInputTokens
				cacheRead = event.Message.Usage.CacheReadInputTokens
			case "message_delta":
				outputTokens = event.Usage.OutputTokens
			case "content_block_delta":
				if event.Delta.Type == "text_delta" {
					responseText.WriteString(event.Delta.Text)
				}
			}
		}
	} else {
		var resp struct {
			Model   string `json:"model"`
			Usage struct {
				InputTokens              int `json:"input_tokens"`
				OutputTokens             int `json:"output_tokens"`
				CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
				CacheReadInputTokens     int `json:"cache_read_input_tokens"`
			} `json:"usage"`
			Content []struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"content"`
		}
		if err := json.Unmarshal(body, &resp); err == nil {
			model = resp.Model
			inputTokens = resp.Usage.InputTokens
			outputTokens = resp.Usage.OutputTokens
			cacheWrite = resp.Usage.CacheCreationInputTokens
			cacheRead = resp.Usage.CacheReadInputTokens
			for _, block := range resp.Content {
				if block.Type == "text" {
					responseText.WriteString(block.Text)
				}
			}
		}
	}

	log.Printf("proxy: parsed usage — model=%q input=%d output=%d cache_r=%d cache_w=%d streaming=%v status=%d",
		model, inputTokens, outputTokens, cacheRead, cacheWrite, isStreaming, statusCode)

	// Prometheus metrics
	statusStr := strconv.Itoa(statusCode)
	metrics.RequestsTotal.WithLabelValues(model, statusStr).Inc()
	if latencyMs > 0 {
		metrics.RequestDuration.WithLabelValues(model).Observe(float64(latencyMs))
	}
	if ttftMs > 0 {
		metrics.TTFT.WithLabelValues(model).Observe(float64(ttftMs))
	}
	if inputTokens > 0 {
		metrics.TokensTotal.WithLabelValues("input").Add(float64(inputTokens))
	}
	if outputTokens > 0 {
		metrics.TokensTotal.WithLabelValues("output").Add(float64(outputTokens))
	}
	if cacheRead > 0 {
		metrics.TokensTotal.WithLabelValues("cache_read").Add(float64(cacheRead))
	}
	if cacheWrite > 0 {
		metrics.TokensTotal.WithLabelValues("cache_write").Add(float64(cacheWrite))
	}

	entry := database.UsageLog{
		UserID:       userID,
		AccountID:    accountID,
		Model:        model,
		InputTokens:  inputTokens,
		OutputTokens: outputTokens,
		CacheRead:    cacheRead,
		CacheWrite:   cacheWrite,
		Endpoint:     endpoint,
		StatusCode:   statusCode,
		LatencyMs:    latencyMs,
		TTFTMs:       ttftMs,
	}

	if err := db.Create(&entry).Error; err != nil {
		log.Printf("failed to log usage (user=%d, account=%d): %v", userID, accountID, err)
		return
	}

	if logStream != nil {
		if raw, err := json.Marshal(entry); err == nil {
			logStream.Publish(raw)
		}
	}

	if statsStream != nil {
		evt, _ := json.Marshal(map[string]interface{}{
			"type":          "usage",
			"input_tokens":  inputTokens,
			"output_tokens": outputTokens,
			"model":         model,
		})
		statsStream.Publish(evt)
	}

	// Save conversation log if we have message content
	if len(messagesJSON) > 0 && messagesJSON != "null" {
		logID := entry.ID
		db.Create(&database.ConversationLog{
			UserID:       userID,
			UsageLogID:   &logID,
			Model:        model,
			MessagesJSON: messagesJSON,
			ResponseText: responseText.String(),
			InputTokens:  inputTokens,
			OutputTokens: outputTokens,
		})
	}
}

type limitedWriter struct {
	w       io.Writer
	limit   int
	written int
}

func (lw *limitedWriter) Write(p []byte) (n int, err error) {
	if lw.written >= lw.limit {
		return len(p), nil // Silently discard after limit
	}
	remaining := lw.limit - lw.written
	toWrite := p
	if len(toWrite) > remaining {
		toWrite = toWrite[:remaining]
	}
	n, err = lw.w.Write(toWrite)
	lw.written += n
	if err != nil {
		return len(p), nil // Always report full write to not break TeeReader
	}
	return len(p), nil
}

// ── helpers ──────────────────────────────────────────────────────────────────

func ipAllowed(r *http.Request, whitelist string) bool {
	clientIP := r.Header.Get("X-Forwarded-For")
	if clientIP == "" {
		clientIP = r.RemoteAddr
	}
	// Take first IP from X-Forwarded-For chain.
	if idx := strings.Index(clientIP, ","); idx != -1 {
		clientIP = strings.TrimSpace(clientIP[:idx])
	}
	// Strip port.
	if host, _, err := net.SplitHostPort(clientIP); err == nil {
		clientIP = host
	}
	ip := net.ParseIP(clientIP)
	if ip == nil {
		return false
	}
	for _, cidr := range strings.Split(whitelist, ",") {
		cidr = strings.TrimSpace(cidr)
		if cidr == "" {
			continue
		}
		if strings.Contains(cidr, "/") {
			_, network, err := net.ParseCIDR(cidr)
			if err == nil && network.Contains(ip) {
				return true
			}
		} else if net.ParseIP(cidr) != nil && net.ParseIP(cidr).Equal(ip) {
			return true
		}
	}
	return false
}

func modelAllowed(body []byte, allowedModels string) bool {
	var req struct {
		Model string `json:"model"`
	}
	if err := json.Unmarshal(body, &req); err != nil || req.Model == "" {
		return true // non-messages endpoints
	}
	for _, allowed := range strings.Split(allowedModels, ",") {
		allowed = strings.TrimSpace(allowed)
		if strings.EqualFold(allowed, req.Model) {
			return true
		}
	}
	return false
}

func rewriteModel(body []byte, resolve func(string) string) []byte {
	var req map[string]json.RawMessage
	if err := json.Unmarshal(body, &req); err != nil {
		return body
	}
	modelRaw, ok := req["model"]
	if !ok {
		return body
	}
	var model string
	if err := json.Unmarshal(modelRaw, &model); err != nil || model == "" {
		return body
	}
	// Strip display suffix like "[1m]" appended by Claude Code UI
	if idx := strings.IndexByte(model, '['); idx != -1 {
		model = model[:idx]
	}
	resolved := resolve(model)
	if resolved == model {
		return body
	}
	raw, err := json.Marshal(resolved)
	if err != nil {
		return body
	}
	req["model"] = raw
	result, err := json.Marshal(req)
	if err != nil {
		return body
	}
	return result
}

// estimateMonthlyCost queries the DB for cost since monthStart.
func estimateMonthlyCost(db *gorm.DB, userID uint, monthStart time.Time) float64 {
	type row struct {
		Model        string
		InputTokens  int64
		OutputTokens int64
	}
	var rows []row
	db.Model(&database.UsageLog{}).
		Where("user_id = ? AND created_at >= ?", userID, monthStart).
		Select("model, COALESCE(SUM(input_tokens),0) as input_tokens, COALESCE(SUM(output_tokens),0) as output_tokens").
		Group("model").Scan(&rows)
	var total float64
	for _, r := range rows {
		total += estimateCostRow(r.Model, r.InputTokens, r.OutputTokens)
	}
	return total
}

// estimateCostRow is a lightweight copy of the pricing logic from handlers/stats.go.
var modelPricingProxy = map[string][2]float64{
	"claude-opus-4":     {15.0, 75.0},
	"claude-sonnet-4":   {3.0, 15.0},
	"claude-haiku-4":    {0.80, 4.0},
	"claude-3-5-sonnet": {3.0, 15.0},
	"claude-3-5-haiku":  {0.80, 4.0},
	"claude-3-opus":     {15.0, 75.0},
	"claude-3-sonnet":   {3.0, 15.0},
	"claude-3-haiku":    {0.25, 1.25},
}

func estimateCostRow(model string, input, output int64) float64 {
	for substr, price := range modelPricingProxy {
		if strings.Contains(model, substr) {
			return float64(input)/1_000_000*price[0] + float64(output)/1_000_000*price[1]
		}
	}
	return 0
}

func injectSystemPrompt(body []byte, prefix string) []byte {
	var parsed map[string]interface{}
	if err := json.Unmarshal(body, &parsed); err != nil {
		return body
	}
	existing, _ := parsed["system"].(string)
	if existing != "" {
		parsed["system"] = prefix + "\n\n" + existing
	} else {
		parsed["system"] = prefix
	}
	result, err := json.Marshal(parsed)
	if err != nil {
		return body
	}
	return result
}

func writeError(w http.ResponseWriter, code int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}
