package handlers

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"claude-proxy/internal/database"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"gorm.io/gorm"
)

// platforms maps platform identifiers to their binary filenames.
var platforms = map[string]string{
	"linux-amd64":   "cl-linux-amd64",
	"linux-arm64":   "cl-linux-arm64",
	"darwin-amd64":  "cl-darwin-amd64",
	"darwin-arm64":  "cl-darwin-arm64",
	"windows-amd64": "cl-windows-amd64.exe",
}

// binarySentinel is the prefix we search for in the binary to embed a unique key.
// The cl binary must contain the string "CLBINTOK:" followed by exactly 32 hex characters.
const binarySentinel = "CLBINTOK:"
const binaryKeyLen = 32

type DownloadsHandler struct {
	db      *gorm.DB
	distDir string
}

func NewDownloadsHandler(db *gorm.DB, distDir string) *DownloadsHandler {
	return &DownloadsHandler{db: db, distDir: distDir}
}

// patchBinaryToken replaces the placeholder key inside a cl binary with a unique token.
// Returns the original data unchanged if the sentinel is not found.
func patchBinaryToken(data []byte, key string) []byte {
	sentinel := []byte(binarySentinel)
	idx := bytes.Index(data, sentinel)
	if idx < 0 {
		return data
	}
	tokenStart := idx + len(sentinel)
	if tokenStart+binaryKeyLen > len(data) {
		return data
	}
	patched := make([]byte, len(data))
	copy(patched, data)
	copy(patched[tokenStart:tokenStart+binaryKeyLen], []byte(key[:binaryKeyLen]))
	return patched
}

func newBinaryKey() string {
	return strings.ReplaceAll(uuid.New().String(), "-", "")
}

// ListPlatforms returns available platforms and whether the binary is present.
func (h *DownloadsHandler) ListPlatforms(w http.ResponseWriter, r *http.Request) {
	type platformInfo struct {
		Platform  string `json:"platform"`
		Filename  string `json:"filename"`
		Available bool   `json:"available"`
	}

	var result []platformInfo
	for platform, filename := range platforms {
		_, err := os.Stat(filepath.Join(h.distDir, filename))
		result = append(result, platformInfo{
			Platform:  platform,
			Filename:  filename,
			Available: err == nil,
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(result)
}

// AuthDownload serves a cl binary to an authenticated admin, patching in a unique key.
func (h *DownloadsHandler) AuthDownload(w http.ResponseWriter, r *http.Request) {
	platform := chi.URLParam(r, "platform")
	filename, ok := platforms[platform]
	if !ok {
		http.Error(w, "unknown platform", http.StatusBadRequest)
		return
	}

	path := filepath.Join(h.distDir, filename)
	data, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, "binary not available", http.StatusNotFound)
		return
	}

	key := newBinaryKey()
	patched := patchBinaryToken(data, key)

	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(patched)))
	w.Write(patched)
}

// PreAuthDownload serves a cl binary using a pre-generated token link, patching in a unique key.
func (h *DownloadsHandler) PreAuthDownload(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")

	// Atomically increment counter only when all conditions are met.
	result := h.db.Model(&database.DownloadLink{}).
		Where(
			"token = ? AND revoked = false AND (expires_at IS NULL OR expires_at > ?) AND (max_downloads = 0 OR downloads < max_downloads)",
			token, time.Now(),
		).
		UpdateColumn("downloads", gorm.Expr("downloads + 1"))

	if result.Error != nil || result.RowsAffected == 0 {
		http.Error(w, "link invalid, expired, or exhausted", http.StatusForbidden)
		return
	}

	var link database.DownloadLink
	if err := h.db.Where("token = ?", token).First(&link).Error; err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	filename, ok := platforms[link.Platform]
	if !ok {
		http.Error(w, "unknown platform", http.StatusInternalServerError)
		return
	}

	path := filepath.Join(h.distDir, filename)
	data, err := os.ReadFile(path)
	if err != nil {
		http.Error(w, "binary not available", http.StatusNotFound)
		return
	}

	key := newBinaryKey()
	patched := patchBinaryToken(data, key)

	// Store the binary key on the download link record.
	h.db.Model(&database.DownloadLink{}).Where("id = ?", link.ID).Update("binary_key", key)

	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(len(patched)))
	w.Write(patched)
}

// ListLinks returns all pre-auth download links (admin).
func (h *DownloadsHandler) ListLinks(w http.ResponseWriter, r *http.Request) {
	var links []database.DownloadLink
	h.db.Order("created_at desc").Find(&links)
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(links)
}

type createLinkRequest struct {
	Label        string     `json:"label"`
	Platform     string     `json:"platform"`
	MaxDownloads int        `json:"max_downloads"`
	ExpiresAt    *time.Time `json:"expires_at"`
}

// CreateLink creates a new pre-auth download link (admin).
func (h *DownloadsHandler) CreateLink(w http.ResponseWriter, r *http.Request) {
	var req createLinkRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "invalid body", http.StatusBadRequest)
		return
	}

	if _, ok := platforms[req.Platform]; !ok {
		http.Error(w, "unknown platform", http.StatusBadRequest)
		return
	}

	link := database.DownloadLink{
		Token:        "dl-" + uuid.New().String(),
		Label:        req.Label,
		Platform:     req.Platform,
		MaxDownloads: req.MaxDownloads,
		ExpiresAt:    req.ExpiresAt,
	}

	if err := h.db.Create(&link).Error; err != nil {
		http.Error(w, "db error", http.StatusInternalServerError)
		return
	}

	logAudit(h.db, r, "download_link.create", fmt.Sprintf("link:%d", link.ID),
		fmt.Sprintf("platform=%s label=%s", link.Platform, link.Label))

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(link)
}

// RevokeLink marks a download link as revoked without deleting it (admin).
func (h *DownloadsHandler) RevokeLink(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))

	result := h.db.Model(&database.DownloadLink{}).Where("id = ?", id).Update("revoked", true)
	if result.Error != nil || result.RowsAffected == 0 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	logAudit(h.db, r, "download_link.revoke", fmt.Sprintf("link:%d", id), "")
	w.WriteHeader(http.StatusNoContent)
}

// DeleteLink permanently deletes a download link (admin).
func (h *DownloadsHandler) DeleteLink(w http.ResponseWriter, r *http.Request) {
	id, _ := strconv.Atoi(chi.URLParam(r, "id"))

	result := h.db.Delete(&database.DownloadLink{}, id)
	if result.Error != nil || result.RowsAffected == 0 {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	logAudit(h.db, r, "download_link.delete", fmt.Sprintf("link:%d", id), "")
	w.WriteHeader(http.StatusNoContent)
}

// ListBinaryDownloads returns all user binary download records (admin).
func (h *DownloadsHandler) ListBinaryDownloads(w http.ResponseWriter, r *http.Request) {
	var records []database.UserBinaryDownload
	h.db.Preload("User").Order("downloaded_at desc").Find(&records)
	writeJSON(w, http.StatusOK, records)
}
