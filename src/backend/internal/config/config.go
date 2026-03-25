package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	WebPort           string
	JWTSecret         string
	JWTExpiry         time.Duration
	DBType            string // "sqlite" (default) or "postgres"
	DBPath            string
	PostgresDSN       string
	AnthropicURL      string
	OAuthRefreshURL   string
	AdminUsername     string
	AdminPassword     string
	EncryptionKey     string
	DataDir           string
	PoolResetInterval time.Duration
	UserMaxRPM        int
	RedisURL          string // optional, enables Redis-backed rate limiter
	DistDir              string        // directory containing cl binaries for download
	PromptCacheInject    bool          // inject cache_control on long system prompts (default: true)
	HealthCheckInterval  time.Duration // how often to test Claude accounts (0 = disabled)
	ClaudeAIURL          string        // Claude.ai API base (default: https://api.claude.ai)
	CORSOrigins          string        // comma-separated allowed origins (* = all)
	SystemPromptInject   string        // prepended to system prompt on every request
	ResponseCacheTTL     time.Duration // 0 = disabled
}

func Load() *Config {
	jwtExpiry := 24 * time.Hour
	if v := os.Getenv("JWT_EXPIRY_HOURS"); v != "" {
		if h, err := strconv.Atoi(v); err == nil {
			jwtExpiry = time.Duration(h) * time.Hour
		}
	}

	jwtSecret := getEnv("JWT_SECRET", "change-me-in-production-please")
	encKey := getEnv("ENCRYPTION_KEY", jwtSecret)

	var poolResetInterval time.Duration
	if v := os.Getenv("POOL_RESET_INTERVAL_MINUTES"); v != "" {
		if m, err := strconv.Atoi(v); err == nil && m > 0 {
			poolResetInterval = time.Duration(m) * time.Minute
		}
	}

	return &Config{
		WebPort:         getEnv("WEB_PORT", "3000"),
		JWTSecret:       jwtSecret,
		JWTExpiry:       jwtExpiry,
		DBType:          getEnv("DB_TYPE", "sqlite"),
		DBPath:          getEnv("DB_PATH", "/data/claude-proxy.db"),
		PostgresDSN:     getEnv("POSTGRES_DSN", ""),
		AnthropicURL:    getEnv("ANTHROPIC_URL", "https://api.anthropic.com"),
		OAuthRefreshURL: getEnv("OAUTH_REFRESH_URL", "https://console.anthropic.com/v1/oauth/token"),
		AdminUsername:   getEnv("ADMIN_USERNAME", "admin"),
		AdminPassword:   getEnv("ADMIN_PASSWORD", ""),
		EncryptionKey:   encKey,
		DataDir:         getEnv("DATA_DIR", "/data"),
		PoolResetInterval: poolResetInterval,
		UserMaxRPM: func() int {
			if v := os.Getenv("USER_MAX_RPM"); v != "" {
				if n, err := strconv.Atoi(v); err == nil {
					return n
				}
			}
			return 0
		}(),
		RedisURL: getEnv("REDIS_URL", ""),
		DistDir:           getEnv("DIST_DIR", "/usr/local/share/cl"),
		PromptCacheInject: getEnv("PROMPT_CACHE_INJECT", "true") != "false",
		ClaudeAIURL:   getEnv("CLAUDE_AI_URL", "https://api.claude.ai"),
		CORSOrigins:   getEnv("CORS_ORIGINS", "*"),
		SystemPromptInject: getEnv("SYSTEM_PROMPT_INJECT", ""),
		ResponseCacheTTL: func() time.Duration {
			if v := os.Getenv("RESPONSE_CACHE_TTL_SECONDS"); v != "" {
				if s, err := strconv.Atoi(v); err == nil && s > 0 {
					return time.Duration(s) * time.Second
				}
			}
			return 0
		}(),
		HealthCheckInterval: func() time.Duration {
			if v := os.Getenv("HEALTH_CHECK_INTERVAL_MINUTES"); v != "" {
				if m, err := strconv.Atoi(v); err == nil && m > 0 {
					return time.Duration(m) * time.Minute
				}
			}
			return 0
		}(),
	}
}

func getEnv(key, defaultValue string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return defaultValue
}
