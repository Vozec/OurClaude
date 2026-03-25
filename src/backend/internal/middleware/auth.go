package middleware

import (
	"context"
	"crypto/subtle"
	"net/http"
	"strings"

	"claude-proxy/internal/auth"
	"claude-proxy/internal/config"
)

type contextKey string

const adminKey contextKey = "admin"

func Authenticate(cfg *config.Config) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cookie, err := r.Cookie(auth.CookieName)
			if err != nil {
				http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
				return
			}

			claims, err := auth.ValidateToken(cookie.Value, cfg.JWTSecret)
			if err != nil {
				http.Error(w, `{"error":"invalid session"}`, http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), adminKey, claims)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func CSRFProtect(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Skip safe methods
		if r.Method == "GET" || r.Method == "HEAD" || r.Method == "OPTIONS" {
			next.ServeHTTP(w, r)
			return
		}
		// Skip proxy path (uses API key auth, not cookies)
		if strings.HasPrefix(r.URL.Path, "/proxy") {
			next.ServeHTTP(w, r)
			return
		}
		// Skip public endpoints
		if r.URL.Path == "/api/auth/login" || r.URL.Path == "/api/invite/use" {
			next.ServeHTTP(w, r)
			return
		}

		cookie, err := r.Cookie("csrf_token")
		if err != nil {
			http.Error(w, `{"error":"missing CSRF token"}`, http.StatusForbidden)
			return
		}
		token := r.Header.Get("X-CSRF-Token")
		if token == "" || subtle.ConstantTimeCompare([]byte(cookie.Value), []byte(token)) != 1 {
			http.Error(w, `{"error":"invalid CSRF token"}`, http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func GetAdmin(ctx context.Context) *auth.Claims {
	v := ctx.Value(adminKey)
	if v == nil {
		return nil
	}
	claims, _ := v.(*auth.Claims)
	return claims
}
