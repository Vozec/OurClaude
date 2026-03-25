package database

import "time"

type Admin struct {
	ID           uint      `gorm:"primarykey" json:"id"`
	Username     string    `gorm:"uniqueIndex;not null" json:"username"`
	PasswordHash string    `gorm:"not null" json:"-"`
	TOTPSecret   string    `json:"-"`
	TOTPEnabled  bool      `gorm:"default:false" json:"totp_enabled"`
	Role         string    `gorm:"default:'super_admin'" json:"role"` // super_admin, viewer
	CreatedAt    time.Time `json:"created_at"`
}

type Pool struct {
	ID                uint            `gorm:"primarykey" json:"id"`
	Name              string          `gorm:"uniqueIndex;not null" json:"name"`
	Description       string          `json:"description"`
	DailyTokenQuota   int             `gorm:"default:0" json:"daily_token_quota"`   // 0 = unlimited
	MonthlyTokenQuota int             `gorm:"default:0" json:"monthly_token_quota"` // 0 = unlimited
	CreatedAt         time.Time       `json:"created_at"`
	Accounts          []ClaudeAccount `gorm:"many2many:account_pools;joinForeignKey:PoolID;joinReferences:AccountID" json:"accounts,omitempty"`
}

type ClaudeAccount struct {
	ID           uint       `gorm:"primarykey" json:"id"`
	Pools        []*Pool    `gorm:"many2many:account_pools;joinForeignKey:AccountID;joinReferences:PoolID" json:"pools,omitempty"`
	Name         string     `gorm:"not null" json:"name"`
	AccessToken  string     `gorm:"not null" json:"-"`
	RefreshToken string     `gorm:"not null" json:"-"`
	ExpiresAt    time.Time  `json:"expires_at"`
	AccountType  string     `gorm:"default:'oauth'" json:"account_type"` // "oauth" or "apikey"
	Status       string     `gorm:"default:'active'" json:"status"`
	LastError    string     `json:"last_error,omitempty"`
	LastUsedAt   *time.Time `json:"last_used_at,omitempty"`
	OwnerUserID  *uint      `gorm:"index" json:"owner_user_id,omitempty"` // proxy user who owns this account
	CreatedAt    time.Time  `json:"created_at"`
}

type User struct {
	ID                uint       `gorm:"primarykey" json:"id"`
	Name              string     `gorm:"not null" json:"name"`
	APIToken          string     `gorm:"uniqueIndex;not null" json:"api_token"`
	Pools             []*Pool    `gorm:"many2many:user_pools;joinForeignKey:UserID;joinReferences:PoolID" json:"pools,omitempty"`
	Active            bool       `gorm:"default:true" json:"active"`
	TokenExpiresAt    *time.Time `json:"token_expires_at,omitempty"`
	DailyTokenQuota   int        `gorm:"default:0" json:"daily_token_quota"`    // 0 = unlimited
	MonthlyTokenQuota int        `gorm:"default:0" json:"monthly_token_quota"`  // 0 = unlimited
	MonthlyBudgetUSD  float64    `gorm:"default:0" json:"monthly_budget_usd"`   // 0 = unlimited
	AllowedModels     string     `json:"allowed_models"`   // comma-separated, empty = all
	IPWhitelist       string     `json:"ip_whitelist"`     // comma-separated CIDRs, empty = all
	ExtraHeaders      string     `json:"extra_headers"`    // JSON map injected into upstream requests
	CreatedAt         time.Time  `json:"created_at"`
}

type UsageLog struct {
	ID           uint      `gorm:"primarykey" json:"id"`
	UserID       uint      `gorm:"not null;index" json:"user_id"`
	User         *User     `gorm:"foreignKey:UserID" json:"user,omitempty"`
	AccountID    uint      `gorm:"not null;index" json:"account_id"`
	Model        string    `json:"model"`
	InputTokens  int       `json:"input_tokens"`
	OutputTokens int       `json:"output_tokens"`
	CacheRead    int       `json:"cache_read"`
	CacheWrite   int       `json:"cache_write"`
	Endpoint     string    `json:"endpoint"`
	StatusCode   int       `json:"status_code"`
	LatencyMs    int       `json:"latency_ms"`
	TTFTMs       int       `json:"ttft_ms"` // 0 if non-streaming
	CreatedAt    time.Time `gorm:"index" json:"created_at"`
}

type WebhookConfig struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	URL       string    `gorm:"not null" json:"url"`
	Events    string    `gorm:"not null" json:"events"` // comma-separated: account.exhausted,account.error
	Secret    string    `json:"secret,omitempty"`        // HMAC secret, only shown on create
	Active    bool      `gorm:"default:true" json:"active"`
	CreatedAt time.Time `json:"created_at"`
}

type AuditLog struct {
	ID            uint      `gorm:"primarykey" json:"id"`
	AdminID       uint      `gorm:"index" json:"admin_id"`
	AdminUsername string    `json:"admin_username"`
	Action        string    `gorm:"not null" json:"action"`
	Target        string    `json:"target"`
	Details       string    `json:"details"`
	CreatedAt     time.Time `gorm:"index" json:"created_at"`
}

type InviteToken struct {
	ID        uint       `gorm:"primarykey" json:"id"`
	Token     string     `gorm:"uniqueIndex;not null" json:"token"`
	Pools     []*Pool    `gorm:"many2many:invite_pools;joinForeignKey:InviteID;joinReferences:PoolID" json:"pools,omitempty"`
	Label     string     `json:"label"`
	ExpiresAt time.Time  `json:"expires_at"`
	UsedAt    *time.Time `json:"used_at,omitempty"`
	UsedBy    string     `json:"used_by,omitempty"` // name of user who accepted
	CreatedAt time.Time  `json:"created_at"`
}

type AdminSession struct {
	ID          uint      `gorm:"primarykey" json:"id"`
	AdminID     uint      `gorm:"not null;index" json:"admin_id"`
	Admin       *Admin    `gorm:"foreignKey:AdminID" json:"admin,omitempty"`
	TokenHash   string    `gorm:"uniqueIndex;not null" json:"-"`
	IP          string    `json:"ip"`
	UserAgent   string    `json:"user_agent"`
	LastUsedAt  time.Time `json:"last_used_at"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
}

type ModelAlias struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	Alias     string    `gorm:"uniqueIndex;not null" json:"alias"`
	Target    string    `gorm:"not null" json:"target"`
	CreatedAt time.Time `json:"created_at"`
}

type DownloadLink struct {
	ID           uint       `gorm:"primarykey" json:"id"`
	Token        string     `gorm:"uniqueIndex;not null" json:"token"`
	Label        string     `json:"label"`
	Platform     string     `gorm:"not null" json:"platform"` // linux-amd64, linux-arm64, darwin-amd64, darwin-arm64, windows-amd64
	MaxDownloads int        `gorm:"default:1" json:"max_downloads"` // 0 = unlimited
	Downloads    int        `gorm:"default:0" json:"downloads"`
	Revoked      bool       `gorm:"default:false" json:"revoked"`
	BinaryKey    string     `json:"binary_key,omitempty"` // unique key embedded in the served binary
	ExpiresAt    *time.Time `json:"expires_at,omitempty"`
	UserID       *uint      `gorm:"index" json:"user_id,omitempty"` // user this link was generated for
	User         *User      `gorm:"foreignKey:UserID" json:"user,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

// UserBinaryDownload tracks which binary (identified by key) each user has downloaded.
type UserBinaryDownload struct {
	ID           uint      `gorm:"primarykey" json:"id"`
	UserID       uint      `gorm:"index" json:"user_id"`
	User         *User     `gorm:"foreignKey:UserID" json:"user,omitempty"`
	Platform     string    `json:"platform"`
	BinaryKey    string    `gorm:"uniqueIndex;not null" json:"binary_key"`
	DownloadedAt time.Time `json:"downloaded_at"`
}

// ConversationLog stores the full message content of each proxied request.
type ConversationLog struct {
	ID           uint      `gorm:"primarykey" json:"id"`
	UserID       uint      `gorm:"not null;index" json:"user_id"`
	User         *User     `gorm:"foreignKey:UserID" json:"user,omitempty"`
	UsageLogID   *uint     `gorm:"index" json:"usage_log_id,omitempty"`
	Model        string    `json:"model"`
	MessagesJSON string    `gorm:"type:text" json:"-"`
	ResponseText string    `gorm:"type:text" json:"-"`
	InputTokens  int       `json:"input_tokens"`
	OutputTokens int       `json:"output_tokens"`
	CreatedAt    time.Time `gorm:"index" json:"created_at"`
}

// AccountPool is a many-to-many join between accounts and pools.
type AccountPool struct {
	ID        uint  `gorm:"primarykey" json:"id"`
	AccountID uint  `gorm:"not null;index;uniqueIndex:account_pool_unique" json:"account_id"`
	PoolID    uint  `gorm:"not null;index;uniqueIndex:account_pool_unique" json:"pool_id"`
	Pool      *Pool `gorm:"foreignKey:PoolID" json:"pool,omitempty"`
}

// UserPool is a many-to-many join between users and pools.
type UserPool struct {
	ID     uint  `gorm:"primarykey" json:"id"`
	UserID uint  `gorm:"not null;index;uniqueIndex:user_pool_unique" json:"user_id"`
	PoolID uint  `gorm:"not null;index;uniqueIndex:user_pool_unique" json:"pool_id"`
	Pool   *Pool `gorm:"foreignKey:PoolID" json:"pool,omitempty"`
}

// InvitePool is a many-to-many join between invites and pools.
type InvitePool struct {
	ID       uint  `gorm:"primarykey" json:"id"`
	InviteID uint  `gorm:"not null;index;uniqueIndex:invite_pool_unique" json:"invite_id"`
	PoolID   uint  `gorm:"not null;index;uniqueIndex:invite_pool_unique" json:"pool_id"`
	Pool     *Pool `gorm:"foreignKey:PoolID" json:"pool,omitempty"`
}

// SetupToken is a temporary link that lets a user view their own onboarding info.
type SetupToken struct {
	ID        uint      `gorm:"primarykey" json:"id"`
	Token     string    `gorm:"uniqueIndex;not null" json:"token"`
	UserID    uint      `gorm:"not null;index" json:"user_id"`
	User      *User     `gorm:"foreignKey:UserID" json:"user,omitempty"`
	ExpiresAt time.Time `json:"expires_at"`
	CreatedAt time.Time `json:"created_at"`
}
