import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { accountsApi, poolsApi, Account, Pool } from '../lib/api'
import { Plus, Trash2, RefreshCw, RotateCcw, CheckCircle, AlertCircle, Clock } from 'lucide-react'

function StatusBadge({ status }: { status: Account['status'] }) {
  if (status === 'active')    return <span className="flex items-center gap-1 text-green-600 text-sm"><CheckCircle className="w-3.5 h-3.5" />Active</span>
  if (status === 'exhausted') return <span className="flex items-center gap-1 text-yellow-600 text-sm"><Clock className="w-3.5 h-3.5" />Exhausted</span>
  return <span className="flex items-center gap-1 text-red-600 text-sm"><AlertCircle className="w-3.5 h-3.5" />Error</span>
}

function AddAccountModal({ pools, onClose }: { pools: Pool[]; onClose: () => void }) {
  const [name, setName] = useState('')
  const [poolId, setPoolId] = useState<string>(pools[0]?.id ? String(pools[0].id) : '')
  const [credJson, setCredJson] = useState('')
  const [error, setError] = useState('')
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => accountsApi.create({
      name,
      pool_id: Number(poolId),
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pool</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white"
              value={poolId} onChange={e => setPoolId(e.target.value)}
            >
              {pools.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
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
            disabled={!name || !poolId || !credJson || mutation.isPending}
            className="flex-1 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50"
          >
            {mutation.isPending ? 'Adding...' : 'Add Account'}
          </button>
        </div>
      </div>
    </div>
  )
}

type Toast = { id: number; message: string; ok: boolean }

export default function Accounts() {
  const [showAdd, setShowAdd] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const qc = useQueryClient()

  const addToast = (message: string, ok: boolean) => {
    const id = Date.now()
    setToasts(t => [...t, { id, message, ok }])
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 4000)
  }

  const { data: accounts = [], isLoading } = useQuery({ queryKey: ['accounts'], queryFn: accountsApi.list })
  const { data: pools = [] } = useQuery({ queryKey: ['pools'], queryFn: poolsApi.list })

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

  const poolName = (poolId: number) => pools.find(p => p.id === poolId)?.name ?? '—'

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
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Pool</th>
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
                      {account.owner_user_id && (
                        <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded text-xs font-medium" title={`Owned by user #${account.owner_user_id} — credentials synced via cl`}>
                          personal
                        </span>
                      )}
                    </div>
                    {account.last_error && (
                      <p className="text-xs text-red-500 mt-0.5 truncate max-w-[200px]">{account.last_error}</p>
                    )}
                  </td>
                  <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{poolName(account.pool_id)}</td>
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
    </div>
  )
}
