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

	// Composite indexes for frequent query patterns
	db.Exec("CREATE INDEX IF NOT EXISTS idx_usage_user_created ON usage_logs(user_id, created_at)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_usage_account_created ON usage_logs(account_id, created_at)")
	db.Exec("CREATE INDEX IF NOT EXISTS idx_conv_user_created ON conversation_logs(user_id, created_at)")

	return db, nil
}
