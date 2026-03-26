# OurClaude V1 — Final Polish ToDo

## CRITICAL — Backend bugs

- [x] Pool `AllowedModels` enforced in proxy
- [x] Pool deletion cleans `account_pools`, `user_pools`, `invite_pools`
- [x] Team deletion clears `user.team_id`
- [x] `GET /api/admin/teams/{id}` endpoint added
- [x] `team_id` in User Create/Update API
- [x] Missing `logAudit` on: Account Update, MCP Update, Settings Update, Team Update
- [x] Logs show 0 tokens and "-" model — fixed \r\n SSE parsing
- [x] Token refresh 404 — fixed: JSON body instead of form-encoded

## HIGH — UX from Opium comparison

- [x] Drain mode / reset-aware scheduling — scoredPick with 5h reset bonus
- [x] Account health score — weighted scoring in scoredPick

## HIGH — Navigation & Layout

- [x] Sidebar grouped into sections (Management / Monitoring / Configuration)
- [x] Collapsible sidebar for smaller screens
- [x] Highlight nav items with critical alerts

## HIGH — Missing detail pages & views

- [x] Team detail page with members, budget, edit/delete
- [x] PoolDetail: replace ∞ with "Unlimited", quota progress bars
- [x] PoolDetail: "Add Account to Pool" button
- [x] Pool inline edit

## IMPORTANT — Account/User detail

- [x] AccountDetail: absolute token counts on quota bars
- [x] AccountDetail: timestamp on error messages
- [x] UserDetail: countdown for token expiry
- [x] UserDetail: "No restrictions" instead of blank

## IMPORTANT — Quotas page

- [x] Color legend (Red/Amber/Green)
- [x] Stale data warning (>1h old)
- [x] Sort quota bars by severity

## IMPORTANT — Logs page

- [x] Page count display "Showing X of Y"
- [x] Live indicator (pulsing red dot)
- [x] Active filter pills (removable)

## IMPORTANT — Pools page

- [x] Truncate model list: show 3 + "+X more"
- [x] Show pool quota usage

## NICE-TO-HAVE

- [x] Heatmap: explain units
- [x] Cost breakdown section
- [x] Manual TOTP key entry
- [x] 2FA backup codes
- [x] Search/filter on all list pages
- [x] Login spinner
- [x] Teams member count column
