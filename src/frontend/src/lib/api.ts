const BASE = '/api'

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: 'include',
  })

  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    try {
      const data = await res.json()
      msg = data.error || msg
    } catch {}
    throw new Error(msg)
  }

  if (res.status === 204 || res.headers.get('Content-Length') === '0') {
    return undefined as T
  }

  return res.json()
}

const get  = <T>(path: string)              => request<T>('GET',    path)
const post = <T>(path: string, b?: unknown) => request<T>('POST',   path, b)
const put  = <T>(path: string, b?: unknown) => request<T>('PUT',    path, b)
const del  = <T>(path: string)              => request<T>('DELETE', path)

// Auth
export const authApi = {
  login:          (body: { username: string; password: string; totp_code?: string }) =>
                    post<{ admin: Admin }>('/auth/login', body),
  logout:         () => post('/auth/logout'),
  me:             () => get<Admin>('/auth/me'),
  totpSetup:      () => post<{ secret: string; qr_url: string }>('/auth/totp/setup'),
  totpEnable:     (code: string) => post('/auth/totp/enable', { code }),
  totpDisable:    (code: string) => post('/auth/totp/disable', { code }),
  changePassword: (current_password: string, new_password: string) =>
                    put('/auth/password', { current_password, new_password }),
}

// Setup links
export const setupApi = {
  get: (token: string) => get<SetupLinkData>(`/setup/${token}`),
}

// Users
export const usersApi = {
  list:        () => get<User[]>('/admin/users'),
  create:      (body: {
                  name: string
                  pool_ids?: number[]
                  token_expires_at?: string
                  daily_token_quota?: number
                  monthly_token_quota?: number
                  allowed_models?: string
                  ip_whitelist?: string
                  monthly_budget_usd?: number
                  extra_headers?: string
                }) => post<User>('/admin/users', body),
  update:      (id: number, body: Partial<{
                  name: string
                  pool_ids: number[]
                  active: boolean
                  token_expires_at: string | null
                  daily_token_quota: number
                  monthly_token_quota: number
                  allowed_models: string
                  ip_whitelist: string
                  monthly_budget_usd: number
                  extra_headers: string
                }>) => put<User>(`/admin/users/${id}`, body),
  delete:           (id: number) => del(`/admin/users/${id}`),
  rotateToken:      (id: number) => post<{ api_token: string }>(`/admin/users/${id}/rotate-token`),
  generateSetupLink:(id: number) => post<{ url: string }>(`/admin/users/${id}/setup-link`),
  stats:            (id: number) => get<UserStats>(`/admin/users/${id}/stats`),
}

// Pools
export const poolsApi = {
  list:   () => get<Pool[]>('/admin/pools'),
  create: (body: { name: string; description?: string; daily_token_quota?: number; monthly_token_quota?: number }) => post<Pool>('/admin/pools', body),
  update: (id: number, body: Partial<{ name: string; description: string; daily_token_quota: number; monthly_token_quota: number }>) =>
            put<Pool>(`/admin/pools/${id}`, body),
  delete: (id: number) => del(`/admin/pools/${id}`),
  reset:  (id: number) => post(`/admin/pools/${id}/reset`),
  stats:  (id: number) => get<PoolStats>(`/admin/pools/${id}/stats`),
  users:  (id: number) => get<User[]>(`/admin/pools/${id}/users`),
}

// Accounts
export const accountsApi = {
  list:        () => get<Account[]>('/admin/accounts'),
  stats:       (id: number) => get<AccountStats>(`/admin/accounts/${id}/stats`),
  create:      (body: { name: string; pool_ids?: number[]; account_type?: string; credentials_json?: string; api_key?: string }) =>
                 post<Account>('/admin/accounts', body),
  update:      (id: number, body: Partial<{ name: string; pool_ids: number[] }>) =>
                 put<Account>(`/admin/accounts/${id}`, body),
  delete:      (id: number) => del(`/admin/accounts/${id}`),
  refresh:     (id: number) => post<{ expires_at: string }>(`/admin/accounts/${id}/refresh`),
  reset:       (id: number) => post(`/admin/accounts/${id}/reset`),
  test:        (id: number) => post<{ status_code: number; ok: boolean }>(`/admin/accounts/${id}/test`),
  credentials: (id: number) => get<Record<string, unknown>>(`/admin/accounts/${id}/credentials`),
  unlink:      (id: number, poolId?: number) => del<void>(`/admin/accounts/${id}/pool${poolId ? `?pool_id=${poolId}` : ''}`),
  quota:       (id: number) => get<unknown>(`/admin/accounts/${id}/quota`),
  toggle:      (id: number) => post<{ status: string }>(`/admin/accounts/${id}/toggle`),
}

// Stats
export const statsApi = {
  overview:    () => get<OverviewStats>('/admin/stats/overview'),
  usage:       (params?: { page?: number; limit?: number; user_id?: number; model?: string; status_class?: string; endpoint?: string }) => {
    const q = new URLSearchParams()
    if (params?.page)         q.set('page',         String(params.page))
    if (params?.limit)        q.set('limit',        String(params.limit))
    if (params?.user_id)      q.set('user_id',      String(params.user_id))
    if (params?.model)        q.set('model',        params.model)
    if (params?.status_class) q.set('status_class', params.status_class)
    if (params?.endpoint)     q.set('endpoint',     params.endpoint)
    return get<UsagePage>(`/admin/stats/usage?${q}`)
  },
  byUser:      () => get<UserStat[]>('/admin/stats/by-user'),
  byDay:       () => get<DayStat[]>('/admin/stats/by-day'),
  byModel:     () => get<ModelStat[]>('/admin/stats/by-model'),
  latency:     () => get<LatencyStat[]>('/admin/stats/latency'),
  byModelDay:  () => get<ModelDayStat[]>('/admin/stats/by-model-day'),
  heatmap:     (days?: number) => get<HeatmapPoint[]>(`/admin/stats/heatmap${days ? `?days=${days}` : ''}`),
  sessions:    (hours?: number) => get<SessionStat[]>(`/admin/stats/sessions${hours ? `?hours=${hours}` : ''}`),
  exportURL:   (params?: { user_id?: number; model?: string; status_class?: string; endpoint?: string }) => {
    const q = new URLSearchParams()
    if (params?.user_id) q.set('user_id', String(params.user_id))
    return `/api/admin/stats/export?${q}`
  },
}

// Admins
export const adminsApi = {
  list:   () => get<Admin[]>('/admin/admins'),
  create: (body: { username: string; password: string; role?: string }) =>
            post<Admin>('/admin/admins', body),
  update: (id: number, body: { password?: string; role?: string }) =>
            put(`/admin/admins/${id}`, body),
  delete: (id: number) => del(`/admin/admins/${id}`),
}

// Webhooks
export const webhooksApi = {
  list:   () => get<Webhook[]>('/admin/webhooks'),
  create: (body: { url: string; events: string; secret?: string }) =>
            post<Webhook>('/admin/webhooks', body),
  update: (id: number, body: { url?: string; events?: string; active?: boolean }) =>
            put(`/admin/webhooks/${id}`, body),
  delete: (id: number) => del(`/admin/webhooks/${id}`),
}

// Invites
export const invitesApi = {
  list:   () => get<Invite[]>('/admin/invites'),
  create: (body: { label?: string; pool_ids?: number[]; expires_in_hours?: number }) =>
            post<InviteCreated>('/admin/invites', body),
  delete: (id: number) => del(`/admin/invites/${id}`),
  use:    (body: { token: string; name: string }) =>
            post<{ name: string; api_token: string; download_links?: Record<string, string> }>('/invite/use', body),
}

// Audit
export const auditApi = {
  list: (params?: { page?: number; limit?: number; admin_id?: number }) => {
    const q = new URLSearchParams()
    if (params?.page)     q.set('page',     String(params.page))
    if (params?.limit)    q.set('limit',    String(params.limit))
    if (params?.admin_id) q.set('admin_id', String(params.admin_id))
    return get<AuditPage>(`/admin/audit?${q}`)
  },
}

// Downloads
export const downloadsApi = {
  listPlatforms:      () => get<PlatformInfo[]>('/downloads'),
  downloadURL:        (platform: string) => `/api/downloads/${platform}`,
  listLinks:          () => get<DownloadLink[]>('/admin/download-links'),
  createLink:         (body: {
                        label?: string
                        platform: string
                        max_downloads?: number
                        expires_at?: string
                      }) => post<DownloadLink>('/admin/download-links', body),
  revokeLink:         (id: number) => post(`/admin/download-links/${id}/revoke`),
  deleteLink:         (id: number) => del(`/admin/download-links/${id}`),
  preAuthURL:         (token: string) => `/dl/${token}`,
  listBinaryDownloads: () => get<UserBinaryDownload[]>('/admin/binary-downloads'),
}

// Model Aliases
export const aliasesApi = {
  list:   () => get<ModelAlias[]>("/admin/model-aliases"),
  create: (body: { alias: string; target: string }) => post<ModelAlias>("/admin/model-aliases", body),
  delete: (id: number) => del(`/admin/model-aliases/${id}`),
}

// Sessions
export const sessionsApi = {
  list:   () => get<AdminSession[]>("/admin/sessions"),
  revoke: (id: number) => del(`/admin/sessions/${id}`),
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Admin {
  id: number
  username: string
  totp_enabled: boolean
  role: string
  created_at: string
}

export interface Pool {
  id: number
  name: string
  description: string
  created_at: string
  daily_token_quota: number
  monthly_token_quota: number
  accounts?: Account[]
}

export interface Account {
  id: number
  pools?: Pool[]
  account_type?: 'oauth' | 'apikey'
  name: string
  status: 'active' | 'exhausted' | 'error' | 'disabled'
  last_error?: string
  expires_at: string
  last_used_at?: string
  owner_user_id?: number
  created_at: string
}

export interface User {
  id: number
  name: string
  api_token: string
  pools?: Pool[]
  active: boolean
  token_expires_at?: string
  daily_token_quota: number
  monthly_token_quota: number
  allowed_models: string
  ip_whitelist: string
  monthly_budget_usd: number
  extra_headers: string
  created_at: string
}

export interface UserStats {
  today:    { requests: number; input_tokens: number; output_tokens: number }
  week:     { requests: number; input_tokens: number; output_tokens: number }
  accounts: Account[]
}

export interface UsageLog {
  id: number
  user_id: number
  account_id: number
  user?: { name: string }
  model: string
  input_tokens: number
  output_tokens: number
  cache_read: number
  cache_write: number
  endpoint: string
  status_code: number
  latency_ms: number
  ttft_ms: number
  created_at: string
}

export interface OverviewStats {
  total_requests: number
  total_input: number
  total_output: number
  total_cache_read: number
  total_cache_write: number
  estimated_cost: number
  active_users: number
  total_users: number
  account_statuses: Array<{ status: string; count: number }>
}

export interface UsagePage {
  total: number
  page: number
  limit: number
  logs: UsageLog[]
}

export interface UserStat {
  user_id: number
  user_name: string
  total_requests: number
  input_tokens: number
  output_tokens: number
  estimated_cost_usd: number
}

export interface DayStat {
  day: string
  total_requests: number
  input_tokens: number
  output_tokens: number
}

export interface ModelStat {
  model: string
  total_requests: number
  input_tokens: number
  output_tokens: number
  estimated_cost_usd: number
}

export interface Webhook {
  id: number
  url: string
  events: string
  active: boolean
  created_at: string
}

export interface Invite {
  id: number
  token: string
  label: string
  pools?: Pool[]
  expires_at: string
  used_at?: string
  used_by?: string
  created_at: string
}

export interface InviteCreated {
  id: number
  token: string
  label: string
  pool_ids?: number[]
  expires_at: string
}

export interface SetupLinkData {
  name: string
  api_token: string
  pools: Pool[]
  download_links: Record<string, string>
}

export interface AuditEntry {
  id: number
  admin_id: number
  admin_username: string
  action: string
  target: string
  details: string
  created_at: string
}

export interface AuditPage {
  total: number
  page: number
  limit: number
  logs: AuditEntry[]
}

export interface PlatformInfo {
  platform: string
  filename: string
  available: boolean
}

export interface DownloadLink {
  id: number
  token: string
  label: string
  platform: string
  max_downloads: number
  downloads: number
  revoked: boolean
  expires_at?: string
  created_at: string
}

export interface ModelAlias {
  id: number
  alias: string
  target: string
  created_at: string
}

export interface AdminSession {
  id: number
  admin_id: number
  admin_username: string
  ip: string
  user_agent: string
  last_used_at: string
  expires_at: string
  created_at: string
}

export interface LatencyStat {
  model: string
  p50_ms: number
  p95_ms: number
  p99_ms: number
  count: number
}

export interface ModelDayStat {
  day: string
  model: string
  requests: number
  input_tokens: number
  output_tokens: number
}

export interface HeatmapPoint {
  day_of_week: number  // 0=Sun..6=Sat
  hour_of_day: number
  count: number
}

export interface SessionStat {
  user_id: number
  user_name: string
  session_count: number
  total_requests: number
  avg_session_duration_min: number
  avg_messages_per_session: number
  total_input_tokens: number
  total_output_tokens: number
}

export interface UserBinaryDownload {
  id: number
  user_id: number
  user?: { name: string }
  platform: string
  binary_key: string
  downloaded_at: string
}

export interface PeriodStats {
  requests: number
  input_tokens: number
  output_tokens: number
  est_cost_usd?: number
}

export interface PoolStats {
  pool: Pool
  today: PeriodStats
  week: PeriodStats
  month: PeriodStats
}

export interface AccountStats {
  today: PeriodStats
  week: PeriodStats
  total: PeriodStats
}

// Conversations
export const conversationsApi = {
  list: (params?: { page?: number; limit?: number; user_id?: number }) => {
    const q = new URLSearchParams()
    if (params?.page)    q.set('page',    String(params.page))
    if (params?.limit)   q.set('limit',   String(params.limit))
    if (params?.user_id) q.set('user_id', String(params.user_id))
    return get<ConversationPage>(`/admin/conversations?${q}`)
  },
  get:       (id: number) => get<ConversationDetail>(`/admin/conversations/${id}`),
  exportURL: () => `/api/admin/conversations/export`,
  exportOneURL: (id: number) => `/api/admin/conversations/${id}/export`,
}

export interface ConversationSummary {
  id: number
  user_id: number
  user_name: string
  usage_log_id?: number
  model: string
  input_tokens: number
  output_tokens: number
  created_at: string
}

export interface ConversationPage {
  total: number
  page: number
  limit: number
  logs: ConversationSummary[]
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string | Array<{ type: string; text?: string }>
}

export interface ConversationDetail {
  id: number
  user_id: number
  user_name: string
  usage_log_id?: number
  model: string
  messages: ConversationMessage[] | null | undefined
  response: string
  input_tokens: number
  output_tokens: number
  created_at: string
}
