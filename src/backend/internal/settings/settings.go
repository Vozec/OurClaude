package settings

import (
	"strconv"
	"sync"
	"time"

	"claude-proxy/internal/database"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Service provides thread-safe, DB-backed runtime settings with in-memory cache.
type Service struct {
	db    *gorm.DB
	mu    sync.RWMutex
	cache map[string]string
}

// New creates a settings service, loads current values from DB.
func New(db *gorm.DB) *Service {
	s := &Service{
		db:    db,
		cache: make(map[string]string),
	}
	s.reload()
	return s
}

// SeedDefaults writes default values for keys that don't exist in DB yet.
// Called once at startup with values from env vars.
func (s *Service) SeedDefaults(defaults map[string]string) {
	for k, v := range defaults {
		s.db.Clauses(clause.OnConflict{DoNothing: true}).Create(&database.Setting{
			Key:   k,
			Value: v,
		})
	}
	s.reload()
}

// Get returns the value for a key, or empty string if not found.
func (s *Service) Get(key string) string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.cache[key]
}

// GetBool returns true if the value is "true" or "1".
func (s *Service) GetBool(key string) bool {
	v := s.Get(key)
	return v == "true" || v == "1"
}

// GetInt returns the integer value, or 0 if not parseable.
func (s *Service) GetInt(key string) int {
	n, _ := strconv.Atoi(s.Get(key))
	return n
}

// Set updates a setting in DB and cache immediately.
func (s *Service) Set(key, value string) error {
	now := time.Now()
	err := s.db.Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "key"}},
		DoUpdates: clause.AssignmentColumns([]string{"value", "updated_at"}),
	}).Create(&database.Setting{
		Key:       key,
		Value:     value,
		UpdatedAt: now,
	}).Error
	if err != nil {
		return err
	}

	s.mu.Lock()
	s.cache[key] = value
	s.mu.Unlock()
	return nil
}

// All returns a copy of all settings.
func (s *Service) All() map[string]string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make(map[string]string, len(s.cache))
	for k, v := range s.cache {
		result[k] = v
	}
	return result
}

func (s *Service) reload() {
	var rows []database.Setting
	s.db.Find(&rows)
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, r := range rows {
		s.cache[r.Key] = r.Value
	}
}
