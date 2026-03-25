import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi, poolsApi, User, Pool } from '../lib/api'
import { Plus, RotateCcw, Trash2, Edit2, Copy, Check, Clock, Gauge, Terminal } from 'lucide-react'

function Badge({ active }: { active: boolean }) {
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
      {active ? 'Active' : 'Disabled'}
    </span>
  )
}

function CopyToken({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="flex items-center gap-2">
      <code className="text-xs bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-2 py-1 rounded font-mono">
        {token.slice(0, 20)}...
      </code>
      <button onClick={copy} className="text-gray-400 hover:text-gray-600">
        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  )
}

function fmt(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

function PoolCheckboxList({ pools, selected, onChange }: {
  pools: Pool[]
  selected: number[]
  onChange: (ids: number[]) => void
}) {
  function toggle(id: number) {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }
  if (pools.length === 0) {
    return <p className="text-sm text-gray-400 dark:text-gray-500 italic">No pools available.</p>
  }
  return (
    <div className="border border-gray-200 dark:border-gray-600 rounded-lg max-h-36 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
      {pools.map(p => (
        <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700">
          <input
            type="checkbox"
            checked={selected.includes(p.id)}
            onChange={() => toggle(p.id)}
            className="w-4 h-4 text-brand-500 rounded"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">{p.name}</span>
          {p.description && <span className="text-xs text-gray-400 dark:text-gray-500 truncate">{p.description}</span>}
        </label>
      ))}
    </div>
  )
}

function CreateUserModal({ pools, onClose }: { pools: Pool[]; onClose: () => void }) {
  const [name, setName]       = useState('')
  const [poolIds, setPoolIds] = useState<number[]>([])
  const [expiresAt, setExpiresAt] = useState('')
  const [dailyQuota, setDailyQuota]     = useState('')
  const [monthlyQuota, setMonthlyQuota] = useState('')
  const [allowedModels, setAllowedModels] = useState('')
  const [ipWhitelist, setIpWhitelist] = useState('')
  const [monthlyBudget, setMonthlyBudget] = useState('')
  const [extraHeaders, setExtraHeaders] = useState('')
  const [error, setError]     = useState('')
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => usersApi.create({
      name,
      pool_ids: poolIds,
      ...(expiresAt ? { token_expires_at: new Date(expiresAt).toISOString() } : {}),
      ...(dailyQuota   ? { daily_token_quota:   Number(dailyQuota) }   : {}),
      ...(monthlyQuota ? { monthly_token_quota: Number(monthlyQuota) } : {}),
      ...(allowedModels ? { allowed_models: allowedModels } : {}),
      ...(ipWhitelist   ? { ip_whitelist: ipWhitelist }     : {}),
      ...(monthlyBudget ? { monthly_budget_usd: Number(monthlyBudget) } : {}),
      ...(extraHeaders  ? { extra_headers: extraHeaders }   : {}),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-5 dark:text-white">Create User</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              value={name} onChange={e => setName(e.target.value)} placeholder="Alice"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pools (optional)</label>
            <PoolCheckboxList pools={pools} selected={poolIds} onChange={setPoolIds} />
            {poolIds.length > 0 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {poolIds.length} pool{poolIds.length > 1 ? 's' : ''} selected — load distributed across all
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Token expiry (optional)
            </label>
            <input
              type="datetime-local"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white"
              value={expiresAt} onChange={e => setExpiresAt(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Daily token quota</label>
              <input
                type="number" min="0"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                value={dailyQuota} onChange={e => setDailyQuota(e.target.value)} placeholder="0 = unlimited"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monthly token quota</label>
              <input
                type="number" min="0"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                value={monthlyQuota} onChange={e => setMonthlyQuota(e.target.value)} placeholder="0 = unlimited"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Allowed models (empty = all)</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              value={allowedModels} onChange={e => setAllowedModels(e.target.value)} placeholder="e.g. claude-haiku-4-5,claude-sonnet-4-6"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">IP whitelist (empty = all)</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              value={ipWhitelist} onChange={e => setIpWhitelist(e.target.value)} placeholder="e.g. 192.168.1.0/24,10.0.0.1"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monthly budget $</label>
              <input
                type="number" min="0" step="0.01"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                value={monthlyBudget} onChange={e => setMonthlyBudget(e.target.value)} placeholder="0 = unlimited"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Extra headers (JSON, optional)</label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono text-xs dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              rows={2}
              value={extraHeaders} onChange={e => setExtraHeaders(e.target.value)} placeholder='{"x-custom": "value"}'
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!name || mutation.isPending}
            className="flex-1 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EditUserModal({ user, pools, onClose }: { user: User; pools: Pool[]; onClose: () => void }) {
  // Initialize from user.pools (multi) or fall back to legacy user.pool_id
  const initialPoolIds = user.pools && user.pools.length > 0
    ? user.pools.map(p => p.id)
    : user.pool_id ? [user.pool_id] : []

  const [poolIds, setPoolIds] = useState<number[]>(initialPoolIds)
  const [active, setActive] = useState(user.active)
  const [dailyQuota, setDailyQuota]     = useState(String(user.daily_token_quota ?? 0))
  const [monthlyQuota, setMonthlyQuota] = useState(String(user.monthly_token_quota ?? 0))
  const [allowedModels2, setAllowedModels2] = useState(user.allowed_models ?? '')
  const [ipWhitelist2, setIpWhitelist2] = useState(user.ip_whitelist ?? '')
  const [monthlyBudget2, setMonthlyBudget2] = useState(String(user.monthly_budget_usd ?? 0))
  const [extraHeaders2, setExtraHeaders2] = useState(user.extra_headers ?? '')
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => usersApi.update(user.id, {
      pool_ids:            poolIds,
      active,
      daily_token_quota:  Number(dailyQuota),
      monthly_token_quota: Number(monthlyQuota),
      allowed_models: allowedModels2,
      ip_whitelist: ipWhitelist2,
      monthly_budget_usd: Number(monthlyBudget2),
      extra_headers: extraHeaders2,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] })
      onClose()
    },
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-5 dark:text-white">Edit User: {user.name}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pools</label>
            <PoolCheckboxList pools={pools} selected={poolIds} onChange={setPoolIds} />
            {poolIds.length > 1 && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                {poolIds.length} pools — requests load-balanced by token availability
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Daily quota (tokens)</label>
              <input
                type="number" min="0"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white"
                value={dailyQuota} onChange={e => setDailyQuota(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monthly quota (tokens)</label>
              <input
                type="number" min="0"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white"
                value={monthlyQuota} onChange={e => setMonthlyQuota(e.target.value)}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="active"
              checked={active}
              onChange={e => setActive(e.target.checked)}
              className="w-4 h-4 text-brand-500 rounded"
            />
            <label htmlFor="active" className="text-sm font-medium text-gray-700 dark:text-gray-300">Active</label>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Allowed models (empty = all)</label>
            <input className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400" value={allowedModels2} onChange={e => setAllowedModels2(e.target.value)} placeholder="e.g. claude-haiku-4-5,claude-sonnet-4-6" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">IP whitelist (empty = all)</label>
            <input className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400" value={ipWhitelist2} onChange={e => setIpWhitelist2(e.target.value)} placeholder="e.g. 192.168.1.0/24,10.0.0.1" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monthly budget $</label>
            <input type="number" min="0" step="0.01" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400" value={monthlyBudget2} onChange={e => setMonthlyBudget2(e.target.value)} placeholder="0 = unlimited" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Extra headers (JSON)</label>
            <textarea className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm font-mono text-xs dark:bg-gray-700 dark:text-white dark:placeholder-gray-400" rows={2} value={extraHeaders2} onChange={e => setExtraHeaders2(e.target.value)} placeholder='{"x-custom": "value"}' />
          </div>
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex-1 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function PoolBadges({ user }: { user: User }) {
  const pools = user.pools && user.pools.length > 0 ? user.pools : user.pool ? [user.pool] : []
  if (pools.length === 0) return <span className="text-gray-300 dark:text-gray-600">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {pools.map(p => (
        <span key={p.id} className="px-1.5 py-0.5 bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 rounded text-xs font-medium">
          {p.name}
        </span>
      ))}
    </div>
  )
}

export default function Users() {
  const [showCreate, setShowCreate] = useState(false)
  const [editUser, setEditUser]     = useState<User | null>(null)
  const qc = useQueryClient()

  const { data: users = [], isLoading } = useQuery({ queryKey: ['users'], queryFn: usersApi.list })
  const { data: pools = [] }            = useQuery({ queryKey: ['pools'], queryFn: poolsApi.list })

  const deleteMutation = useMutation({
    mutationFn: usersApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })
  const rotateMutation = useMutation({
    mutationFn: usersApi.rotateToken,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Users</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Manage proxy users and their API tokens.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600"
        >
          <Plus className="w-4 h-4" />
          New User
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading...</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">No users yet. Create one to get started.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Token</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Pools</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Models</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Quotas</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {users.map(user => (
                <tr key={user.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{user.name}</td>
                  <td className="px-6 py-4"><CopyToken token={user.api_token} /></td>
                  <td className="px-6 py-4"><PoolBadges user={user} /></td>
                  <td className="px-6 py-4 text-sm text-gray-400 dark:text-gray-500">{user.allowed_models ? <span className="font-mono text-xs truncate max-w-[120px] block">{user.allowed_models}</span> : '—'}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-0.5 text-xs text-gray-500 dark:text-gray-400">
                      {user.daily_token_quota > 0 ? (
                        <span className="flex items-center gap-1"><Gauge className="w-3 h-3" />{fmt(user.daily_token_quota)}/day</span>
                      ) : null}
                      {user.monthly_token_quota > 0 ? (
                        <span className="flex items-center gap-1"><Gauge className="w-3 h-3" />{fmt(user.monthly_token_quota)}/mo</span>
                      ) : null}
                      {user.token_expires_at ? (
                        <span className="flex items-center gap-1 text-amber-500">
                          <Clock className="w-3 h-3" />
                          {new Date(user.token_expires_at) < new Date() ? 'expired' : 'expires ' + new Date(user.token_expires_at).toLocaleDateString()}
                        </span>
                      ) : null}
                      {!user.daily_token_quota && !user.monthly_token_quota && !user.token_expires_at && <span className="text-gray-300">—</span>}
                    </div>
                  </td>
                  <td className="px-6 py-4"><Badge active={user.active} /></td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        title="Copy cl login command"
                        onClick={() => navigator.clipboard.writeText(`cl login ${window.location.origin} ${user.api_token}`)}
                        className="p-1.5 text-gray-400 hover:text-brand-500 rounded"
                      >
                        <Terminal className="w-4 h-4" />
                      </button>
                      <button title="Edit" onClick={() => setEditUser(user)} className="p-1.5 text-gray-400 hover:text-brand-500 rounded">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button title="Rotate token" onClick={() => rotateMutation.mutate(user.id)} className="p-1.5 text-gray-400 hover:text-yellow-500 rounded">
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <button
                        title="Delete"
                        onClick={() => { if (confirm(`Delete user "${user.name}"?`)) deleteMutation.mutate(user.id) }}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && <CreateUserModal pools={pools} onClose={() => setShowCreate(false)} />}
      {editUser   && <EditUserModal user={editUser} pools={pools} onClose={() => setEditUser(null)} />}
    </div>
  )
}
