package ratelimit

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

type redisLimiter struct {
	client *redis.Client
	rpm    float64
}

func newRedisLimiter(rpm int, redisURL string) *redisLimiter {
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		log.Fatalf("ratelimit: invalid REDIS_URL: %v", err)
	}
	return &redisLimiter{
		client: redis.NewClient(opt),
		rpm:    float64(rpm),
	}
}

// Allow uses a sliding window counter in Redis.
// Key: rl:{userID}, value: sorted set of request timestamps (ms).
func (l *redisLimiter) Allow(userID uint) bool {
	if l.rpm <= 0 {
		return true
	}

	ctx := context.Background()
	key := fmt.Sprintf("rl:%d", userID)
	now := time.Now()
	windowStart := now.Add(-time.Minute).UnixMilli()
	nowMs := now.UnixMilli()
	// Use nanoseconds as unique member to avoid collisions at same millisecond
	member := fmt.Sprintf("%d", now.UnixNano())

	pipe := l.client.Pipeline()
	pipe.ZRemRangeByScore(ctx, key, "0", fmt.Sprintf("%d", windowStart))
	countCmd := pipe.ZCard(ctx, key)
	pipe.ZAdd(ctx, key, redis.Z{Score: float64(nowMs), Member: member})
	pipe.Expire(ctx, key, 2*time.Minute)

	if _, err := pipe.Exec(ctx); err != nil {
		// Fail open: if Redis is down, allow the request but log warning
		log.Printf("ratelimit: redis error, allowing request: %v", err)
		return true
	}

	return countCmd.Val() < int64(l.rpm)
}
