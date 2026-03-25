package database

import (
	"fmt"

	"gorm.io/driver/postgres"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

// New opens a database connection based on the provided type.
// dbType: "sqlite" (default) or "postgres"
// path: SQLite file path (ignored for postgres)
// dsn: PostgreSQL DSN (ignored for sqlite)
func New(dbType, path, dsn string) (*gorm.DB, error) {
	var dialector gorm.Dialector

	switch dbType {
	case "postgres":
		if dsn == "" {
			return nil, fmt.Errorf("POSTGRES_DSN is required when DB_TYPE=postgres")
		}
		dialector = postgres.Open(dsn)
	default:
		dialector = sqlite.Open(path)
	}

	db, err := gorm.Open(dialector, &gorm.Config{
		Logger: logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, err
	}

	if dbType != "postgres" {
		sqlDB, err := db.DB()
		if err != nil {
			return nil, err
		}
		db.Exec("PRAGMA journal_mode=WAL")
		db.Exec("PRAGMA busy_timeout=5000")
		sqlDB.SetMaxOpenConns(1)
	}

	err = db.AutoMigrate(
		&Admin{},
		&Pool{},
		&ClaudeAccount{},
		&User{},
		&UsageLog{},
		&WebhookConfig{},
		&AuditLog{},
		&InviteToken{},
		&DownloadLink{},
		&AdminSession{},
		&ModelAlias{},
		&UserBinaryDownload{},
		&ConversationLog{},
		&AccountPool{},
		&UserPool{},
		&InvitePool{},
		&SetupToken{},
	)
	if err != nil {
		return nil, err
	}

	// Migrate existing pool_id assignments to account_pools join table (backward compat).
	db.Exec(`
		INSERT INTO account_pools (account_id, pool_id)
		SELECT id, pool_id FROM claude_accounts
		WHERE pool_id IS NOT NULL
		AND NOT EXISTS (
			SELECT 1 FROM account_pools ap WHERE ap.account_id = claude_accounts.id AND ap.pool_id = claude_accounts.pool_id
		)
	`)

	// Migrate existing pool_id assignments to user_pools join table (backward compat).
	db.Exec(`
		INSERT INTO user_pools (user_id, pool_id)
		SELECT id, pool_id FROM users
		WHERE pool_id IS NOT NULL
		AND NOT EXISTS (
			SELECT 1 FROM user_pools up WHERE up.user_id = users.id AND up.pool_id = users.pool_id
		)
	`)

	// Migrate existing pool_id assignments to invite_pools join table (backward compat).
	db.Exec(`
		INSERT INTO invite_pools (invite_id, pool_id)
		SELECT id, pool_id FROM invite_tokens
		WHERE pool_id IS NOT NULL
		AND NOT EXISTS (
			SELECT 1 FROM invite_pools ip WHERE ip.invite_id = invite_tokens.id AND ip.pool_id = invite_tokens.pool_id
		)
	`)

	return db, nil
}
