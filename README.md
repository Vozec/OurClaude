<div align="center">

# OurClaude

**From each account according to its quota, to each user according to their needs.**

<img src=".github/image.jpg" alt="OurClaude" width="100%">

*A multi-account Anthropic proxy. Pool your Claude accounts, share the capacity, let everyone work.*

[![Go](https://img.shields.io/badge/Go-1.22+-00ADD8?style=flat-square&logo=go)](https://go.dev)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react)](https://react.dev)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?style=flat-square&logo=docker)](https://docker.com)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

</div>

---

## Credits

OurClaude is a full rewrite and expansion of an original proof-of-concept by [**pix**](https://github.com/pix), who had the idea first and built the initial working prototype.

---

## The problem

Anthropic's rate limits are per account. Claude Pro gives you ~50 messages per 5 hours. Claude Max gives you more, but it's still capped — and it's expensive.

If you're a team of developers all using Claude through Claude Code, you burn through those limits fast. Each person needs their own account, their own subscription, and manages their own credentials. There's no sharing, no visibility, no control.

**OurClaude fixes that.**

You pool multiple Claude accounts together behind a single proxy. Your team connects through one URL with individual tokens — they get Claude Code working as usual, completely unaware of what's happening underneath. The proxy rotates across accounts automatically, refreshes OAuth tokens, enforces per-user quotas, and gives you a full admin dashboard to see who's using what.

The result: more capacity, shared across the team, at a fraction of the cost of giving everyone a Max subscription.

---

## What is it?

You have multiple Claude accounts. Your team needs Claude. Anthropic has rate limits.

OurClaude sits between your users and Anthropic: it pools all your Claude OAuth accounts, rotates them transparently under load, refreshes tokens automatically, and exposes a single endpoint that's a drop-in replacement for the Anthropic API — no code changes needed.

```
┌─────────────────────────────────────────────────────────────┐
│                         Your team                           │
│   Alice          Bob           Carol          Dave          │
└──────┬───────────┬─────────────┬──────────────┬────────────┘
       │           │             │              │
       └───────────┴──────┬──────┴──────────────┘
                          │  sk-proxy-*
                    ┌─────▼──────┐
                    │  OurClaude │  :3000  (admin + proxy at /proxy)
                    │            │
                    └─────┬──────┘
          ┌───────────────┼───────────────┐
          │               │               │
    ┌─────▼─────┐   ┌─────▼─────┐   ┌────▼──────┐
    │ Account A │   │ Account B │   │ Account C │
    │  (active) │   │ (active)  │   │(exhausted)│
    └───────────┘   └───────────┘   └───────────┘
          │               │
          └───────────────┴──────► api.anthropic.com
```

---

## Features

| | |
|---|---|
| **Account pooling** | Group multiple Claude OAuth accounts into pools. Users are assigned to a pool — or several. |
| **Auto-rotation** | Round-robin across active accounts. On 429, the exhausted account is swapped out instantly. |
| **Token refresh** | Access tokens are refreshed automatically before they expire. No manual intervention. |
| **Quota management** | Per-user daily/monthly token limits and USD budget caps. |
| **Conversation logging** | Capture request/response pairs and browse them from the admin UI. |
| **Admin dashboard** | Full CRUD for users, pools, accounts, webhooks, invites. Analytics and live log stream. |
| **`ourclaude` CLI** | A thin wrapper that routes `claude` through the proxy. Shows a usage dashboard on launch. |
| **Account sync** | Users can share their own Claude account with the proxy (`ourclaude init`). The proxy keeps their local credentials in sync after token rotations. |
| **Invites** | Generate invite links. Users self-onboard and get a `sk-proxy-*` token. |
| **Webhooks** | POST on account events (exhausted, error, quota warning). Discord natively supported. |
| **TOTP 2FA** | Optional on the admin account. Built-in QR code setup. |
| **Model aliases** | Map `gpt-4` → `claude-opus-4-5`. Users don't need to change anything. |
| **Rate limiting** | Per-user request rate cap (token bucket). |

---

## Quick start

### Prerequisites

- Docker + Docker Compose
- One or more Claude accounts (Pro or higher)

### 1. Configure

```bash
git clone https://github.com/your-org/ourclaude
cd ourclaude
cp .env.example .env
```

Open `.env` and set at minimum:

```env
JWT_SECRET=<openssl rand -hex 32>
ADMIN_PASSWORD=<something strong>
```

### 2. Start

```bash
docker compose up -d
```

Admin dashboard → `http://localhost:3000`

### 3. First-time setup

**Add a Claude account**

Go to *Accounts → Add account* and paste the content of `~/.claude/.credentials.json` from a machine where you're logged into Claude.

**Create a pool**

*Pools → New pool*, assign the account to it.

**Create a user**

*Users → New user*, assign the pool. Copy the generated `sk-proxy-*` token.

### 4. Connect

**Drop-in replacement for the Anthropic API:**

```bash
export ANTHROPIC_BASE_URL=http://your-server:3000/proxy
export ANTHROPIC_API_KEY=sk-proxy-xxxxxxxxxxxxxxxx
claude "hello"
```

**With the `ourclaude` CLI:**

```bash
# One-time setup
ourclaude init http://your-server:3000

# Use Claude normally — a usage dashboard appears before each session
ourclaude
ourclaude "explain this code"
ourclaude --model claude-opus-4-5 chat
```

---

## The `ourclaude` CLI

`ourclaude` is a thin wrapper around the `claude` binary. It injects the proxy URL and token, keeps your local credentials in sync, and shows a usage dashboard before launching.

```
┌──────────────────────────────────────────────────────────────┐
│ ✦ OurClaude  ─  Alice                                        │
├──────────────────────────────────────────────────────────────┤
│ TODAY                          THIS WEEK                     │
│ 42 reqs                        234 reqs                      │
│ In 1.2M     Out 340K           In 8.4M     Out 2.1M          │
├──────────────────────────────────────────────────────────────┤
│ Pool: Engineering                                            │
│   ● 3 active   ◐ 1 exhausted   ✗ 0 error                   │
├──────────────────────────────────────────────────────────────┤
│ Daily   ████████████░░░░░░░░   62%   62K / 100K             │
│ Monthly ████░░░░░░░░░░░░░░░░   18%   87K / 500K             │
├──────────────────────────────────────────────────────────────┤
│ ◎ Personal account  ● active  expires 2026-03-26 14:30      │
│   today   42 reqs              week    234 reqs              │
│   In 1.2M     Out 340K         In 8.4M     Out 2.1M          │
└──────────────────────────────────────────────────────────────┘
```

### Commands

```bash
ourclaude init <server> [token]   # Setup + optionally share your Claude account
ourclaude login <server> [token]  # Setup only (no account sharing)
ourclaude logout                  # Remove local config
ourclaude status                  # Show connection info
ourclaude usage                   # Token usage stats (last 7 days)
ourclaude update                  # Self-update binary from server
ourclaude [claude-args...]        # Run claude through the proxy
```

### Getting the binary

Download it from the admin dashboard (*Downloads* section), or via the API:

```bash
curl -O http://your-server:3000/api/user/update?platform=linux-amd64 \
  -H "Authorization: Bearer sk-proxy-xxxx"
chmod +x ourclaude
```

Supported platforms: `linux-amd64`, `linux-arm64`, `darwin-amd64`, `darwin-arm64`, `windows-amd64`.

### Account sync (`ourclaude init`)

If you have a Claude account connected locally, `ourclaude init` detects it and offers to share it with the proxy. The proxy registers it as your *personal account* and keeps your local `~/.claude/.credentials.json` in sync automatically — so token rotations on the proxy side don't break your local Claude session.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | **required** | JWT signing key — `openssl rand -hex 32` |
| `ADMIN_PASSWORD` | **required** | Admin password |
| `ADMIN_USERNAME` | `admin` | Admin username |
| `WEB_PORT` | `3000` | Admin dashboard port |
| `PROXY_PORT` | `8080` | Anthropic proxy port |
| `DB_PATH` | `/data/ourclaude.db` | SQLite database path |
| `ANTHROPIC_URL` | `https://api.anthropic.com` | Upstream Anthropic URL |
| `OAUTH_REFRESH_URL` | `https://console.anthropic.com/v1/oauth/token` | OAuth refresh endpoint |
| `ENCRYPTION_KEY` | *(derived from JWT_SECRET)* | AES-GCM key for stored tokens |
| `JWT_EXPIRY_HOURS` | `24` | Admin session lifetime |
| `POOL_RESET_INTERVAL_MINUTES` | `0` (disabled) | Periodic reset of exhausted accounts |
| `USER_MAX_RPM` | `0` (unlimited) | Per-user request rate limit |
| `PROMPT_CACHE_INJECT` | `false` | Inject `cache_control` on large system prompts |

---

## API reference

### User self-service

All `/api/user/*` endpoints authenticate with the `sk-proxy-*` token — no admin access required.

```bash
GET  /api/user/me                  # Profile + quota usage
GET  /api/user/usage               # Usage stats (last 7 days)
POST /api/user/rotate-token        # Rotate your API token
POST /api/user/import-account      # Share your Claude account with the proxy
GET  /api/user/owned-account       # Get your account's current credentials
GET  /api/user/pool-status         # Pool accounts status + today/week stats
GET  /api/user/update?platform=... # Download ourclaude binary (pre-patched with your token)
```

### Admin API

All `/api/admin/*` endpoints require a JWT session cookie (login via `/api/auth/login`).

```bash
# Auth
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
POST /api/auth/totp/setup
POST /api/auth/totp/enable

# Users
GET    /api/admin/users
POST   /api/admin/users
PUT    /api/admin/users/:id
DELETE /api/admin/users/:id
POST   /api/admin/users/:id/rotate-token

# Pools
GET  /api/admin/pools
POST /api/admin/pools
GET  /api/admin/pools/:id/stats
GET  /api/admin/pools/:id/users
POST /api/admin/pools/:id/reset

# Accounts
GET  /api/admin/accounts
POST /api/admin/accounts
POST /api/admin/accounts/:id/refresh
POST /api/admin/accounts/:id/reset
POST /api/admin/accounts/:id/test
GET  /api/admin/accounts/:id/stats

# Stats & logs
GET /api/admin/stats/overview
GET /api/admin/stats/usage
GET /api/admin/stats/by-user
GET /api/admin/stats/by-day
GET /api/admin/stats/by-model
GET /api/admin/stats/latency
GET /api/admin/stats/export
GET /api/admin/conversations
GET /api/admin/conversations/:id
GET /api/admin/conversations/export

# Misc
GET    /api/admin/webhooks
POST   /api/admin/invites
GET    /api/admin/audit
GET    /api/admin/sessions
GET    /api/admin/model-aliases
GET    /api/admin/download-links
GET    /api/admin/binary-downloads
```

---

## Development

```bash
# Backend (without embedded frontend)
cd src/backend && go run ./cmd/server

# Frontend dev server (proxies to :3000)
cd src/frontend && npm run dev

# Build ourclaude CLI — current platform
make ourclaude

# Build ourclaude CLI — all platforms
make ourclaude-all

# Install locally
make install-ourclaude

# Full production build (frontend embedded in Go binary)
make build
```

---

## Security

- OAuth tokens encrypted with AES-GCM before storage
- Admin sessions via HTTP-only JWT cookies
- TOTP strongly recommended on internet-facing instances
- `sk-proxy-*` tokens are scoped — no admin access, ever
- No secrets in logs
- Invite system for controlled user onboarding

---

## Stack

Go · chi · GORM · SQLite (WAL) · React 18 · TypeScript · Vite · Tailwind CSS · Recharts · TanStack Query
