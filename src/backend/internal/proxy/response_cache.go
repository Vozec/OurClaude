package proxy

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

type cachedResponse struct {
	statusCode int
	headers    map[string][]string
	body       []byte
	expiresAt  time.Time
}

type responseCache struct {
	mu      sync.RWMutex
	cache   map[string]*cachedResponse
	ttl     time.Duration
	maxSize int
}

func newResponseCache(ttl time.Duration) *responseCache {
	return &responseCache{
		cache:   make(map[string]*cachedResponse),
		ttl:     ttl,
		maxSize: 1000,
	}
}

func (c *responseCache) key(userID uint, body []byte) string {
	h := sha256.New()
	h.Write([]byte(fmt.Sprintf("u%d:", userID)))
	h.Write(body)
	return hex.EncodeToString(h.Sum(nil))
}

func (c *responseCache) get(key string) *cachedResponse {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if e, ok := c.cache[key]; ok && time.Now().Before(e.expiresAt) {
		return e
	}
	return nil
}

func (c *responseCache) setWithTTL(key string, entry *cachedResponse, ttl time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()

	// Evict expired entries if at capacity
	if len(c.cache) >= c.maxSize {
		now := time.Now()
		for k, v := range c.cache {
			if now.After(v.expiresAt) {
				delete(c.cache, k)
			}
		}
	}

	if ttl <= 0 {
		ttl = c.ttl
	}
	entry.expiresAt = time.Now().Add(ttl)
	c.cache[key] = entry
}

func (c *responseCache) enabled() bool {
	return c.ttl > 0
}
