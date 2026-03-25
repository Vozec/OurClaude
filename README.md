<div align="center">

# OurClaude

> Built on an idea by [pix](https://github.com/pix) who made the initial POC — thanks for the spark.

**From each account according to its quota, to each user according to their needs.**

<img src=".github/image.jpg" alt="OurClaude" width="100%">

*A multi-account Anthropic proxy. Pool your Claude accounts, share the capacity, let everyone work.*

[![Go](https://img.shields.io/badge/Go-1.25+-00ADD8?style=flat-square&logo=go)](https://go.dev)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)](https://react.dev)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker)](https://docker.com)
[![License](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey?style=flat-square)](LICENSE)

</div>

---

## Credits

OurClaude is a full rewrite and expansion of an original proof-of-concept by [**pix**](https://github.com/pix), who had the idea first and built the initial working prototype.

---

## The Problem

Anthropic's rate limits are per account. Claude Pro gives you ~50 messages per 5 hours. Claude Max gives you more, but it's still capped — and it's expensive.

If you're a team of developers all using Claude through Claude Code, you burn through those limits fast. Each person needs their own account, their own subscription, and manages their own credentials. There's no sharing, no visibility, no control.

**OurClaude fixes that.**

You pool multiple Claude accounts together behind a single proxy. Your team connects through one URL with individual tokens — they get Claude Code working as usual, completely unaware of what's happening underneath. The proxy rotates across accounts automatically, refreshes OAuth tokens, enforces per-user quotas, and gives you a full admin dashboard to see who's using what.

The result: more capacity, shared across the team, at a fraction of the cost of giving everyone a Max subscription.

---

## What Is It?

You have multiple Claude accounts. Your team needs Claude. Anthropic has rate limits.

OurClaude sits between your users and Anthropic: it pools all your Claude OAuth accounts, rotates them transparently under load, refreshes tokens automatically, and exposes a single endpoint that's a drop-in replacement for the Anthropic API — no code changes needed.

When all OAuth accounts are exhausted, it automatically falls back to Anthropic API keys if configured.

```
┌─────────────────────────────────────────────────────────────┐
│                         Your team                           │
│   Alice          Bob           Carol          Dave          │
└──────┬───────────┬─────────────┬──────────────┬────────────┘
       │           │             │              │
       └───────────┴──────┬──────┴──────────────┘
                          │  sk-proxy-*
                    ┌─────▼──────┐
                    │  OurClaude │  :3000 (admin + proxy)
                    │            │
                    └─────┬──────┘
          ┌───────────────┼───────────────┐
          │               │               │
    ┌─────▼─────┐   ┌─────▼─────┐   ┌────▼──────┐
    │ Account A │   │ Account B │   │ API Key   │
    │  (active) │   │ (active)  │   │(fallback) │
    └───────────┘   └───────────┘   └───────────┘
          │               │               │
          └───────────────┴───────────────┘
                          │
                          ▼
                  api.anthropic.com
```

---

## Features

### Account Management
- **OAuth Account Pooling** — Round-robin across multiple Claude OAuth accounts per pool
- **API Key Fallback** — Automatic failover to Anthropic API keys when OAuth accounts are exhausted
- **Multi-Pool Architecture** — Accounts can belong to multiple pools simultaneously
- **Auto Token Refresh** — OAuth tokens refreshed automatically with per-account mutex (no race conditions)
- **Health Checks** — Periodic account health verification with automatic error marking

### User Management
- **Team-Based Quotas** — Organize users into teams with shared budgets
- **Per-User Quotas** — Daily/monthly token limits and USD budget caps
- **Model Access Control** — Restrict which models each pool or user can access
- **IP Whitelisting** — Restrict access by IP/CIDR range per user
- **Rate Limiting** — Per-user RPM limits (in-memory or Redis-backed)

### Admin Dashboard
- **Real-Time Stats** — SSE-powered live dashboard with instant updates
- **Cost Analytics** — Per-model cost estimation, spending forecast, cache savings
- **Activity Heatmap** — 7x24 grid showing usage patterns
- **Session Analytics** — Track user sessions with duration and message counts
- **Latency Monitoring** — P50/P95/P99 latency by model
- **Conversation Logs** — Full request/response logging with per-user export

### Security
- **Multi-Admin** — Multiple admin accounts with super_admin/viewer roles
- **TOTP 2FA** — Time-based one-time passwords for admin login
- **CSRF Protection** — Token-based CSRF validation on all mutations
- **Encrypted Storage** — OAuth tokens encrypted at rest (AES-GCM)
- **Graceful Shutdown** — Clean connection draining on SIGTERM

### Proxy Features
- **System Prompt Injection** — Admin-configurable prompt prepended to all requests
- **Prompt Cache Injection** — Automatic `cache_control` on long system prompts
- **Response Caching** — Hash-based dedup for identical non-streaming requests
- **Request Deduplication** — `Idempotency-Key` header support
- **Model Aliasing** — Remap model names transparently
- **Webhook Notifications** — Slack/Discord alerts with retry (account exhaustion, quota warnings)

### Developer Experience
- **CLI Tool (`ourclaude`)** — Login, status dashboard, credential sync, offline fallback
- **Auto-Install Script** — `curl | sh` with embedded credentials
- **MCP Server Distribution** — Central MCP config pushed to clients
- **Swagger API Docs** — Auto-generated from routes at `/docs`
- **Runtime Settings** — Edit system prompt, cache TTL, rate limits without restart

---

## Quick Start

### Docker (recommended)

```bash
cp .env.example .env
# Edit .env: set JWT_SECRET and ADMIN_PASSWORD
docker compose up -d
```

Open `http://localhost:3000` — login with your admin credentials.

### From Source

```bash
# Backend
cd src/backend && go build -o ../../ourclaude-server ./cmd/server/

# Frontend
cd src/frontend && npm ci && npm run build

# Run
./ourclaude-server
```

---

## CLI Installation

### Automatic (recommended)

Generate a setup link from the admin panel, then:

```bash
curl -sSL https://your-server/api/install/TOKEN | sudo bash
```

### Manual

```bash
wget https://your-server/dl/TOKEN -O ourclaude
chmod +x ourclaude
sudo mv ourclaude /usr/local/bin/
ourclaude login https://your-server sk-proxy-xxxxx
```

### RTK (Recommended)

[RTK (Rust Token Killer)](https://github.com/rtk-ai/rtk) is a token optimizer that reduces Claude Code token usage by **60-90%** by filtering unnecessary context from CLI tool outputs. It's **included by default** in the automatic install script.

To install manually:

```bash
curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | bash
rtk init --global
```

After install, RTK hooks into Claude Code transparently. Run `rtk gain` to see savings.

---

## Configuration

All settings can be configured via environment variables. Runtime-editable settings can also be changed from the admin UI (Settings page).

### Required

| Variable | Description |
|----------|-------------|
| `JWT_SECRET` | Secret for JWT session tokens |
| `ADMIN_PASSWORD` | Initial admin password |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `WEB_PORT` | 3000 | Web server port |
| `ANTHROPIC_URL` | https://api.anthropic.com | Upstream API URL |
| `DB_TYPE` | sqlite | Database type (sqlite/postgres) |
| `DB_PATH` | /data/claude-proxy.db | SQLite file path |
| `CORS_ORIGINS` | * | Allowed CORS origins |
| `REDIS_URL` | | Redis URL for distributed rate limiting |
| `POOL_RESET_INTERVAL_MINUTES` | 0 | Auto-reset exhausted accounts interval |
| `HEALTH_CHECK_INTERVAL_MINUTES` | 0 | Account health check interval |
| `SYSTEM_PROMPT_INJECT` | | System prompt prepended to all requests |
| `PROMPT_CACHE_INJECT` | true | Auto-inject cache_control markers |
| `RESPONSE_CACHE_TTL_SECONDS` | 0 | Response cache TTL (0=disabled) |
| `USER_MAX_RPM` | 0 | Default rate limit per user (0=unlimited) |

---

## API Documentation

Interactive Swagger UI available at `/docs` when the server is running. The spec is auto-generated from routes — every endpoint is documented.

---

## License

This work is licensed under [Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/).

You are free to share and adapt this work for non-commercial purposes, with appropriate credit.
