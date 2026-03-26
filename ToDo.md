# OurClaude V1 — Final Polish ToDo

## CRITICAL — Backend bugs

- [x] Pool `AllowedModels` enforced in proxy
- [x] Pool deletion cleans `account_pools`, `user_pools`, `invite_pools`
- [x] Team deletion clears `user.team_id`
- [x] `GET /api/admin/teams/{id}` endpoint added
- [x] `team_id` in User Create/Update API
- [x] Missing `logAudit` on: Account Update, MCP Update, Settings Update, Team Update
- [ ] Logs show 0 tokens and "-" model — needs investigation with real traffic

## HIGH — UX from Opium comparison

- [ ] Drain mode / reset-aware scheduling — prefer accounts nearing reset
- [ ] Account health score — weighted `(usage_5h × 2) + usage_7d`

## HIGH — Navigation & Layout

- [x] Sidebar grouped into sections (Management / Monitoring / Configuration)
- [ ] Collapsible sidebar for smaller screens
- [ ] Highlight nav items with critical alerts

## HIGH — Missing detail pages & views

- [x] Team detail page with members, budget, edit/delete
- [x] PoolDetail: replace ∞ with "Unlimited", quota progress bars
- [ ] PoolDetail: "Add Account to Pool" button
- [ ] Pool inline edit

## IMPORTANT — Dashboard

- [x] Combined status badges into single line "8 active · 2 exhausted · 1 error"
- [x] Tooltip on "Prompt Cache" explaining savings

## IMPORTANT — Account/User detail

- [ ] AccountDetail: absolute token counts on quota bars
- [ ] AccountDetail: timestamp on error messages
- [ ] UserDetail: countdown for token expiry
- [ ] UserDetail: "No restrictions" instead of blank

## IMPORTANT — Quotas page

- [x] Color legend (Red/Amber/Green)
- [x] Stale data warning (>1h old)
- [ ] Sort quota bars by severity

## IMPORTANT — Logs page

- [x] Page count display "Showing X of Y"
- [x] Live indicator (pulsing red dot)
- [ ] Active filter pills (removable)

## IMPORTANT — Pools page

- [ ] Truncate model list: show 3 + "+X more"
- [ ] Show pool quota usage

## IMPORTANT — Invites

- [x] Countdown format ("Expires in 2h 15m")
- [x] Status badges (Pending / Used / Expired)

## IMPORTANT — Users

- [x] Help text on Allowed Models, IP Whitelist, Extra Headers
- [x] Team select in Create/Edit modals

## IMPORTANT — SetupLink

- [x] Auto-detect OS and highlight matching platform

## NICE-TO-HAVE

- [ ] Heatmap: explain units
- [ ] Cost breakdown section
- [ ] Manual TOTP key entry
- [ ] 2FA backup codes
- [ ] Search/filter on all list pages
- [ ] Login spinner
- [ ] Teams member count column
