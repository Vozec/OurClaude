package oauth

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"claude-proxy/internal/crypto"
	"claude-proxy/internal/database"

	"gorm.io/gorm"
)

// claudeClientID is the public OAuth client ID used by the Claude CLI.
const claudeClientID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"

type Refresher struct {
	client     *http.Client
	refreshURL string
	enc        *crypto.Encryptor
}

func New(refreshURL string, enc *crypto.Encryptor) *Refresher {
	return &Refresher{
		client:     &http.Client{Timeout: 30 * time.Second},
		refreshURL: refreshURL,
		enc:        enc,
	}
}

type refreshResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	ExpiresAt    int64  `json:"expires_at"`
}

func (r *Refresher) RefreshToken(db *gorm.DB, account *database.ClaudeAccount) error {
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("refresh_token", account.RefreshToken)
	form.Set("client_id", claudeClientID)

	req, err := http.NewRequest("POST", r.refreshURL, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := r.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("refresh failed with status %d", resp.StatusCode)
	}

	var result refreshResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return err
	}

	if result.AccessToken == "" {
		return fmt.Errorf("no access token in refresh response")
	}

	var expiresAt time.Time
	if result.ExpiresAt > 0 {
		// milliseconds timestamp
		expiresAt = time.UnixMilli(result.ExpiresAt)
	} else if result.ExpiresIn > 0 {
		expiresAt = time.Now().Add(time.Duration(result.ExpiresIn) * time.Second)
	} else {
		expiresAt = time.Now().Add(1 * time.Hour)
	}

	// Encrypt new tokens
	encAccess, err := r.enc.Encrypt(result.AccessToken)
	if err != nil {
		return err
	}

	var encRefresh string
	if result.RefreshToken != "" {
		encRefresh, err = r.enc.Encrypt(result.RefreshToken)
		if err != nil {
			return err
		}
	} else {
		encRefresh = account.RefreshToken // keep existing (already encrypted in DB)
	}

	now := time.Now()
	updates := map[string]interface{}{
		"access_token":  encAccess,
		"refresh_token": encRefresh,
		"expires_at":    expiresAt,
		"status":        "active",
		"last_error":    "",
		"last_used_at":  now,
	}
	if err := db.Model(account).Updates(updates).Error; err != nil {
		return err
	}

	// Update in-memory account for immediate use
	account.AccessToken = result.AccessToken
	if result.RefreshToken != "" {
		account.RefreshToken = result.RefreshToken
	}
	account.ExpiresAt = expiresAt
	account.Status = "active"
	account.LastUsedAt = &now

	return nil
}

// EnsureValid refreshes the token if it expires within 5 minutes.
// Returns the account with a decrypted, valid access token.
func (r *Refresher) EnsureValid(db *gorm.DB, account *database.ClaudeAccount) error {
	if time.Until(account.ExpiresAt) > 5*time.Minute {
		return nil
	}
	return r.RefreshToken(db, account)
}
