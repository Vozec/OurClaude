package middleware

import (
	"context"
	"net/http"

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

func GetAdmin(ctx context.Context) *auth.Claims {
	v := ctx.Value(adminKey)
	if v == nil {
		return nil
	}
	claims, _ := v.(*auth.Claims)
	return claims
}
