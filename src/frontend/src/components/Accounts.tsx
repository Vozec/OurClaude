import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { accountsApi, poolsApi, usersApi, Account, Pool, User } from '../lib/api'
import { Plus, Trash2, RefreshCw, RotateCcw, CheckCircle, AlertCircle, Clock, X, KeyRound, Pencil, Link2Off, BarChart2 } from 'lucide-react'

function StatusBadge({ status }: { status: Account['status'] }) {
  if (status === 'active')    return <span className="flex items-center gap-1 text-green-600 text-sm"><CheckCircle className="w-3.5 h-3.5" />Active</span>
  if (status === 'exhausted') return <span className="flex items-center gap-1 text-yellow-600 text-sm"><Clock className="w-3.5 h-3.5" />Exhausted</span>
  return <span className="flex items-center gap-1 text-red-600 text-sm"><AlertCircle className="w-3.5 h-3.5" />Error</span>
}

function PoolCheckboxes({ pools, selected, onChange }: { pools: Pool[]; selected: Set<number>; onChange: (s: Set<number>) => void }) {
  const toggle = (id: number) => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    onChange(next)
  }
  return (
    <div className="flex flex-wrap gap-2">
      {pools.map(p => (
        <label key={p.id} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors ${selected.has(p.id) ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
          <input type="checkbox" className="sr-only" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
          {p.name}
        </label>
      ))}
      {pools.length === 0 && <p className="text-xs text-gray-400">No pools available</p>}
    </div>
  )
}

function AddAccountModal({ pools, onClose }: { pools: Pool[]; onClose: () => void }) {
  const [name, setName] = useState('')
  const [selectedPools, setSelectedPools] = useState<Set<number>>(new Set(pools[0]?.id ? [pools[0].id] : []))
  const [credJson, setCredJson] = useState('')
  const [error, setError] = useState('')
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => accountsApi.create({
      name,
      pool_ids: [...selectedPools],
      credentials_json: credJson,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); onClose() },
    onError: (e: Error) => setError(e.message),
  })

  const placeholder = JSON.stringify({
    claudeAiOauth: {
      accessToken: 'sk-ant-oat01-...',
      refreshToken: 'sk-ant-oref01-...',
      expiresAt: 1234567890000,
    }
  }, null, 2)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
        <h2 className="text-lg font-semibold mb-1 dark:text-white">Add Claude Account</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
          Paste the content of <code className="bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-1 rounded">~/.claude/.credentials.json</code>
        </p>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              value={name} onChange={e => setName(e.target.value)} placeholder="My Claude Pro Account"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pools (optional)</label>
            <PoolCheckboxes pools={pools} selected={selectedPools} onChange={setSelectedPools} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Credentials JSON</label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono text-xs h-40 resize-none dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              value={credJson} onChange={e => setCredJson(e.target.value)}
              placeholder={placeholder}
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
            disabled={!name || !credJson || mutation.isPending}
            className="flex-1 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50"
          >
            {mutation.isPending ? 'Adding...' : 'Add Account'}
          </button>
        </div>
      </div>
    </div>
  )
}

function EditAccountModal({ account, pools, onClose }: { account: Account; pools: Pool[]; onClose: () => void }) {
  const [name, setName] = useState(account.name)
  const [selectedPools, setSelectedPools] = useState<Set<number>>(new Set((account.pools ?? []).map(p => p.id)))
  const [error, setError] = useState('')
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => accountsApi.update(account.id, {
      name,
      pool_ids: [...selectedPools],
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); onClose() },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold dark:text-white">Edit Account</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white"
              value={name} onChange={e => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pools</label>
            <PoolCheckboxes pools={pools} selected={selectedPools} onChange={setSelectedPools} />
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
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CredentialsModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const { data, isLoading, error } = useQuery({
    queryKey: ['account-credentials', account.id],
    queryFn: () => accountsApi.credentials(account.id),
  })

  const json = data ? JSON.stringify(data, null, 2) : ''

  const copy = () => {
    navigator.clipboard.writeText(json)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-xl shadow-2xl">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold dark:text-white">Credentials JSON</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
          Paste into <code className="bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-1 rounded">~/.claude/.credentials.json</code>
        </p>
        {isLoading && <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">Loading...</p>}
        {error && <p className="text-sm text-red-500">{(error as Error).message}</p>}
        {data && (
          <>
            <pre className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-xs font-mono overflow-auto max-h-72 text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-all">
              {json}
            </pre>
            <button
              onClick={copy}
              className="mt-3 w-full px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600"
            >
              {copied ? '✓ Copied!' : 'Copy to clipboard'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function QuotaModal({ account, onClose }: { account: Account; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['account-quota', account.id],
    queryFn: () => accountsApi.quota(account.id),
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-xl shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold dark:text-white">Claude.ai Quota — {account.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-5 h-5" /></button>
        </div>
        {isLoading && <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">Fetching from Claude.ai...</p>}
        {error && <p className="text-sm text-red-500">{(error as Error).message}</p>}
        {data !== undefined && (
          <pre className="bg-gray-50 dark:bg-gray-900 rounded-lg p-4 text-xs font-mono overflow-auto max-h-96 text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-all">
            {JSON.stringify(data as object, null, 2)}
          </pre>
        )}
      </div>
    </div>
  )
}

function UserInfoPopup({ user, onClose }: { user: User; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold dark:text-white">Account owner</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-gray-500 dark:text-gray-400">Name</span>
            <span className="font-medium text-gray-900 dark:text-white">{user.name}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-500 dark:text-gray-400">Status</span>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${user.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {user.active ? 'Active' : 'Disabled'}
            </span>
          </div>
          {user.pools && user.pools.length > 0 && (
            <div className="flex items-start justify-between gap-2">
              <span className="text-gray-500 dark:text-gray-400 shrink-0">Pools</span>
              <div className="flex flex-wrap gap-1 justify-end">
                {user.pools.map(p => (
                  <span key={p.id} className="px-1.5 py-0.5 bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 rounded text-xs">{p.name}</span>
                ))}
              </div>
            </div>
          )}
          <div className="pt-2 border-t dark:border-gray-700">
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">API token</p>
            <code className="text-xs bg-gray-50 dark:bg-gray-900 px-2 py-1 rounded font-mono text-gray-700 dark:text-gray-300 break-all block">{user.api_token}</code>
          </div>
        </div>
      </div>
    </div>
  )
}

type Toast = { id: number; message: string; ok: boolean }

export default function Accounts() {
  const [showAdd, setShowAdd] = useState(false)
  const [editAccount, setEditAccount] = useState<Account | null>(null)
  const [credAccount, setCredAccount] = useState<Account | null>(null)
  const [quotaAccount, setQuotaAccount] = useState<Account | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  const qc = useQueryClient()

  const addToast = (message: string, ok: boolean) => {
    const id = Date.now()
    setToasts(t => [...t, { id, message, ok }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }

  const { data: accounts = [], isLoading } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list })
  const { data: pools = [] } = useQuery({ queryKey: ['pools'], queryFn: poolsApi.list })
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list })
  const [ownerUser, setOwnerUser] = useState<User | null>(null)

  const deleteMutation = useMutation({
    mutationFn: accountsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })

  const refreshMutation = useMutation({
    mutationFn: accountsApi.refresh,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); addToast('Token refreshed', true) },
    onError: (e: Error) => addToast('Refresh failed: ' + e.message, false),
  })

  const resetMutation = useMutation({
    mutationFn: accountsApi.reset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  })

  const testMutation = useMutation({
    mutationFn: accountsApi.test,
    onSuccess: (data) => addToast(data.ok ? '✓ Account is working' : `✗ Status code: ${data.status_code}`, data.ok),
    onError: (e: Error) => addToast('Test failed: ' + e.message, false),
  })

  const unlinkMutation = useMutation({
    mutationFn: (id: number) => accountsApi.unlink(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); addToast('Account unlinked from pool', true) },
    onError: (e: Error) => addToast('Unlink failed: ' + e.message, false),
  })

  const poolBadges = (account: Account) => {
    const ap = account.pools ?? []
    if (ap.length === 0) return <span className="text-gray-400">—</span>
    return (
      <div className="flex flex-wrap gap-1">
        {ap.map(p => (
          <span key={p.id} className="px-1.5 py-0.5 bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 rounded text-xs">{p.name}</span>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Toast notifications */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className={`flex items-center gap-2 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium text-white transition-all ${t.ok ? 'bg-green-600' : 'bg-red-600'}`}>
            {t.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            {t.message}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Claude Accounts</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Manage OAuth accounts used by the proxy.</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600"
        >
          <Plus className="w-4 h-4" />
          Add Account
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading...</div>
        ) : accounts.length === 0 ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">
            No accounts yet. Add a Claude account to start proxying.
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Pools</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Token Expires</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Last Used</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {accounts.map(account => (
                <tr key={account.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{account.name}</p>
                      {account.owner_user_id && (() => {
                        const owner = users.find(u => u.id === account.owner_user_id)
                        return (
                          <button
                            onClick={() => owner && setOwnerUser(owner)}
                            title={`Owned by user #${account.owner_user_id} — click to view`}
                            className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded text-xs font-medium hover:bg-purple-200 dark:hover:bg-purple-800/50 transition-colors cursor-pointer"
                          >
                            {owner ? owner.name : 'personal'}
                          </button>
                        )
                      })()}
                    </div>
                    {account.last_error && (
                      <p className="text-xs text-red-500 mt-0.5 truncate max-w-[200px]">{account.last_error}</p>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{poolBadges(account)}</td>
                  <td className="px-6 py-4"><StatusBadge status={account.status} /></td>
                  <td className="px-6 py-4 text-sm">
                    {(() => {
                      const exp = new Date(account.expires_at)
                      const now = new Date()
                      const diffMs = exp.getTime() - now.getTime()
                      if (diffMs < 0) return <span className="text-red-600 font-medium text-xs">EXPIRED</span>
                      if (diffMs < 3_600_000) return <span className="text-amber-600 font-medium text-xs">{'< 1h'}</span>
                      return <span className="text-gray-500 dark:text-gray-400">{exp.toLocaleString()}</span>
                    })()}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                    {account.last_used_at ? new Date(account.last_used_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        title="Test account"
                        onClick={() => testMutation.mutate(account.id)}
                        className="p-1.5 text-gray-400 hover:text-green-500 rounded"
                      >
                        <CheckCircle className="w-4 h-4" />
                      </button>
                      <button
                        title="Refresh token"
                        onClick={() => refreshMutation.mutate(account.id)}
                        className="p-1.5 text-gray-400 hover:text-blue-500 rounded"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                      <button
                        title="Reset to active"
                        onClick={() => resetMutation.mutate(account.id)}
                        className="p-1.5 text-gray-400 hover:text-yellow-500 rounded"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                      <button
                        title="Edit account"
                        onClick={() => setEditAccount(account)}
                        className="p-1.5 text-gray-400 hover:text-indigo-500 rounded"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        title="View credentials JSON"
                        onClick={() => setCredAccount(account)}
                        className="p-1.5 text-gray-400 hover:text-orange-500 rounded"
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                      <button
                        title="Claude.ai quota"
                        onClick={() => setQuotaAccount(account)}
                        className="p-1.5 text-gray-400 hover:text-teal-500 rounded"
                      >
                        <BarChart2 className="w-4 h-4" />
                      </button>
                      {(account.pools ?? []).length > 0 && (
                        <button
                          title="Unlink from all pools"
                          onClick={() => {
                            if (confirm(`Unlink "${account.name}" from all pools?`)) unlinkMutation.mutate(account.id)
                          }}
                          className="p-1.5 text-gray-400 hover:text-purple-500 rounded"
                        >
                          <Link2Off className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        title="Delete"
                        onClick={() => {
                          if (confirm(`Delete account "${account.name}"?`)) deleteMutation.mutate(account.id)
                        }}
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

      {showAdd && <AddAccountModal pools={pools} onClose={() => setShowAdd(false)} />}
      {editAccount && <EditAccountModal account={editAccount} pools={pools} onClose={() => setEditAccount(null)} />}
      {credAccount && <CredentialsModal account={credAccount} onClose={() => setCredAccount(null)} />}
      {quotaAccount && <QuotaModal account={quotaAccount} onClose={() => setQuotaAccount(null)} />}
      {ownerUser && <UserInfoPopup user={ownerUser} onClose={() => setOwnerUser(null)} />}
    </div>
  )
}
