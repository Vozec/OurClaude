package ratelimit

import (
	"sync"
	"time"
)

// Limiter is the interface for per-user rate limiting.
type Limiter interface {
	Allow(userID uint) bool
}

// New returns an in-memory limiter or a Redis-backed one if redisURL is provided.
func New(rpm int, redisURL string) Limiter {
	if redisURL != "" {
		return newRedisLimiter(rpm, redisURL)
	}
	return newMemLimiter(rpm)
}

// --- in-memory token bucket ---

type bucket struct {
	tokens    float64
	lastRefil time.Time
}

type memLimiter struct {
	mu      sync.Mutex
	buckets map[uint]*bucket
	rpm     float64
}

func newMemLimiter(rpm int) *memLimiter {
	return &memLimiter{
		buckets: make(map[uint]*bucket),
		rpm:     float64(rpm),
	}
}

func (l *memLimiter) Allow(userID uint) bool {
	if l.rpm <= 0 {
		return true
	}

	l.mu.Lock()
	defer l.mu.Unlock()

	now := time.Now()
	b, ok := l.buckets[userID]
	if !ok {
		b = &bucket{tokens: l.rpm, lastRefil: now}
		l.buckets[userID] = b
	}

	elapsed := now.Sub(b.lastRefil).Minutes()
	b.tokens += elapsed * l.rpm
	if b.tokens > l.rpm {
		b.tokens = l.rpm
	}
	b.lastRefil = now

	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}
