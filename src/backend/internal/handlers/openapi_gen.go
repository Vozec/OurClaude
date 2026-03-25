package handlers

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/go-chi/chi/v5"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
)

var (
	generatedSpec     []byte
	generatedSpecOnce sync.Once
)

func SetOpenAPISpec(spec []byte) {
	generatedSpec = spec
}

// Route descriptions keyed by "METHOD /path"
var routeDescriptions = map[string]string{
	// Auth
	"POST /api/auth/login":         "Authenticate admin and create session",
	"POST /api/auth/logout":        "End admin session",
	"GET /api/auth/me":             "Get current admin info",
	"POST /api/auth/totp/setup":    "Generate TOTP secret and QR URL",
	"POST /api/auth/totp/enable":   "Enable TOTP with verification code",
	"POST /api/auth/totp/disable":  "Disable TOTP for current admin",
	"PUT /api/auth/password":       "Change admin password",
	// Users
	"GET /api/admin/users":                    "List all proxy users",
	"POST /api/admin/users":                   "Create a new proxy user",
	"GET /api/admin/users/{id}":               "Get user details",
	"PUT /api/admin/users/{id}":               "Update user settings",
	"DELETE /api/admin/users/{id}":            "Delete a user",
	"POST /api/admin/users/{id}/rotate-token": "Rotate user API token",
	"POST /api/admin/users/{id}/setup-link":   "Generate setup link for user",
	"GET /api/admin/users/{id}/stats":         "Get user usage statistics",
	// Pools
	"GET /api/admin/pools":              "List all account pools",
	"POST /api/admin/pools":             "Create a new pool",
	"GET /api/admin/pools/{id}":         "Get pool details with accounts",
	"PUT /api/admin/pools/{id}":         "Update pool settings",
	"DELETE /api/admin/pools/{id}":      "Delete a pool",
	"POST /api/admin/pools/{id}/reset":  "Reset exhausted accounts in pool",
	"GET /api/admin/pools/{id}/stats":   "Get pool usage statistics",
	"GET /api/admin/pools/{id}/users":   "List users assigned to pool",
	// Teams
	"GET /api/admin/teams":          "List all teams",
	"POST /api/admin/teams":         "Create a new team",
	"PUT /api/admin/teams/{id}":     "Update team settings",
	"DELETE /api/admin/teams/{id}":  "Delete a team",
	// Accounts
	"GET /api/admin/accounts":                    "List all Claude accounts",
	"POST /api/admin/accounts":                   "Add OAuth account or API key",
	"GET /api/admin/accounts/{id}":               "Get account details",
	"PUT /api/admin/accounts/{id}":               "Update account settings",
	"DELETE /api/admin/accounts/{id}":            "Delete an account",
	"POST /api/admin/accounts/{id}/refresh":      "Refresh OAuth token",
	"POST /api/admin/accounts/{id}/reset":        "Reset account status to active",
	"POST /api/admin/accounts/{id}/test":         "Test account connectivity",
	"POST /api/admin/accounts/{id}/toggle":       "Toggle account active/disabled",
	"GET /api/admin/accounts/{id}/stats":         "Get account usage statistics",
	"GET /api/admin/accounts/{id}/credentials":   "Get decrypted account credentials",
	"DELETE /api/admin/accounts/{id}/pool":        "Unlink account from pool(s)",
	"GET /api/admin/accounts/{id}/quota":          "Check Claude.ai quota for account",
	// Stats
	"GET /api/admin/stats/overview":     "Dashboard overview statistics",
	"GET /api/admin/stats/usage":        "Paginated usage logs with filters",
	"GET /api/admin/stats/by-user":      "Usage breakdown by user",
	"GET /api/admin/stats/by-day":       "Daily usage for last 30 days",
	"GET /api/admin/stats/by-model":     "Usage breakdown by model",
	"GET /api/admin/stats/export":       "Export usage logs as CSV",
	"GET /api/admin/stats/latency":      "Latency percentiles by model",
	"GET /api/admin/stats/by-model-day": "Per-model daily breakdown",
	"GET /api/admin/stats/heatmap":      "Activity heatmap (day x hour)",
	"GET /api/admin/stats/sessions":     "Session analytics",
	"GET /api/admin/stats/stream":       "Real-time stats via SSE",
	// Admins
	"GET /api/admin/admins":                         "List admin accounts",
	"POST /api/admin/admins":                        "Create admin account",
	"PUT /api/admin/admins/{id}":                    "Update admin account",
	"DELETE /api/admin/admins/{id}":                 "Delete admin account",
	"POST /api/admin/admins/{id}/generate-session":  "Generate session for admin",
	// Webhooks
	"GET /api/admin/webhooks":              "List webhooks",
	"POST /api/admin/webhooks":             "Create webhook",
	"PUT /api/admin/webhooks/{id}":         "Update webhook",
	"DELETE /api/admin/webhooks/{id}":      "Delete webhook",
	"POST /api/admin/webhooks/{id}/test":   "Test webhook delivery",
	// Invites
	"GET /api/admin/invites":           "List invite tokens",
	"POST /api/admin/invites":          "Create invite token",
	"DELETE /api/admin/invites/{id}":   "Delete invite token",
	"POST /api/invite/use":             "Redeem invite token (public)",
	// Audit
	"GET /api/admin/audit": "Query audit log",
	// Conversations
	"GET /api/admin/conversations":             "List conversation logs",
	"GET /api/admin/conversations/export":      "Export all conversations as JSON",
	"GET /api/admin/conversations/{id}":        "Get conversation detail",
	"GET /api/admin/conversations/{id}/export": "Export single conversation",
	// Aliases
	"GET /api/admin/model-aliases":              "List model aliases",
	"POST /api/admin/model-aliases":             "Create model alias",
	"DELETE /api/admin/model-aliases/{id}":      "Delete model alias",
	// Sessions
	"GET /api/admin/sessions":          "List admin sessions",
	"DELETE /api/admin/sessions/{id}":  "Revoke admin session",
	// Settings
	"GET /api/admin/settings": "Get runtime settings",
	"PUT /api/admin/settings": "Update runtime settings",
	// MCP
	"GET /api/admin/mcp-servers":              "List MCP server configs",
	"POST /api/admin/mcp-servers":             "Create MCP server config",
	"PUT /api/admin/mcp-servers/{id}":         "Update MCP server config",
	"DELETE /api/admin/mcp-servers/{id}":      "Delete MCP server config",
	// Downloads
	"GET /api/downloads":                              "List available platforms",
	"GET /api/downloads/{platform}":                   "Download CLI binary",
	"GET /api/admin/download-links":                   "List download links",
	"POST /api/admin/download-links":                  "Create download link",
	"POST /api/admin/download-links/{id}/revoke":      "Revoke download link",
	"DELETE /api/admin/download-links/{id}":           "Delete download link",
	"GET /api/admin/binary-downloads":                 "List binary download history",
	// Logs stream
	"GET /api/admin/logs/stream": "Real-time request logs via SSE",
	// User self-service
	"GET /api/user/me":              "Get current user info",
	"GET /api/user/usage":           "Get personal usage stats",
	"POST /api/user/rotate-token":   "Rotate own API token",
	"GET /api/user/update":          "Check for CLI updates",
	"POST /api/user/import-account": "Import local Claude credentials",
	"GET /api/user/owned-account":   "Get owned account credentials",
	"GET /api/user/pool-status":     "Get pool status for CLI dashboard",
	"GET /api/user/mcp-servers":     "Get MCP server configurations",
	// Public
	"GET /api/setup/{token}":   "Fetch setup link data (public)",
	"GET /api/install/{token}": "Get auto-install script (public)",
	"GET /dl/{token}":          "Pre-auth binary download (public)",
	"GET /healthz":             "Health check",
	"GET /docs":                "Swagger UI",
	"GET /docs/openapi.json":   "OpenAPI specification",
}

var titleCaser = cases.Title(language.English)

// GenerateOpenAPISpec walks a chi router and builds an OpenAPI 3.0.3 JSON spec.
func GenerateOpenAPISpec(r chi.Router) []byte {
	paths := map[string]map[string]interface{}{}

	replacer := strings.NewReplacer("/", "_", "{", "", "}", "")

	chi.Walk(r, func(method, route string, handler http.Handler, middlewares ...func(http.Handler) http.Handler) error {
		// Skip catch-all routes
		if route == "/*" || route == "" {
			return nil
		}

		method = strings.ToLower(method)
		if method == "connect" || method == "trace" {
			return nil
		}

		desc := routeDescriptions[strings.ToUpper(method)+" "+route]
		if desc == "" {
			desc = fmt.Sprintf("%s %s", strings.ToUpper(method), route)
		}

		// Determine tag
		tag := "Public"
		if strings.HasPrefix(route, "/api/admin/") {
			parts := strings.Split(strings.TrimPrefix(route, "/api/admin/"), "/")
			tag = "Admin: " + titleCaser.String(strings.ReplaceAll(parts[0], "-", " "))
		} else if strings.HasPrefix(route, "/api/user/") {
			tag = "User"
		} else if strings.HasPrefix(route, "/api/auth/") {
			tag = "Auth"
		} else if strings.HasPrefix(route, "/proxy") {
			tag = "Proxy"
		}

		opID := strings.ToLower(method) + "_" + replacer.Replace(route)

		op := map[string]interface{}{
			"summary":     desc,
			"tags":        []string{tag},
			"operationId": opID,
			"responses": map[string]interface{}{
				"200": map[string]interface{}{
					"description": "Success",
				},
			},
		}

		// Add path parameters
		params := []map[string]interface{}{}
		for _, seg := range strings.Split(route, "/") {
			if strings.HasPrefix(seg, "{") && strings.HasSuffix(seg, "}") {
				name := seg[1 : len(seg)-1]
				params = append(params, map[string]interface{}{
					"name":     name,
					"in":       "path",
					"required": true,
					"schema":   map[string]string{"type": "string"},
				})
			}
		}
		if len(params) > 0 {
			op["parameters"] = params
		}

		// Add request body for POST/PUT
		if method == "post" || method == "put" {
			op["requestBody"] = map[string]interface{}{
				"content": map[string]interface{}{
					"application/json": map[string]interface{}{
						"schema": map[string]string{"type": "object"},
					},
				},
			}
		}

		if paths[route] == nil {
			paths[route] = map[string]interface{}{}
		}
		paths[route][method] = op
		return nil
	})

	spec := map[string]interface{}{
		"openapi": "3.0.3",
		"info": map[string]interface{}{
			"title":       "OurClaude API",
			"version":     "1.0.0",
			"description": "Multi-user Claude proxy with OAuth account pooling, API key fallback, team quotas, and admin dashboard.",
		},
		"paths": paths,
	}

	data, _ := json.MarshalIndent(spec, "", "  ")
	return data
}
