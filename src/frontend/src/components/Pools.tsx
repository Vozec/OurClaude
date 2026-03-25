import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { poolsApi } from '../lib/api'
import { Plus, Trash2, RefreshCw, ChevronRight } from 'lucide-react'
import { useToast } from './ToastProvider'

function StatusDot({ status }: { status: string }) {
  const c = status === 'active' ? 'bg-green-400' : status === 'exhausted' ? 'bg-yellow-400' : 'bg-red-400'
  return <span className={`inline-block w-2 h-2 rounded-full ${c}`} />
}

function CreatePoolModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [dailyQuota, setDailyQuota] = useState('')
  const [monthlyQuota, setMonthlyQuota] = useState('')
  const [allowedModels, setAllowedModels] = useState('')
  const [error, setError] = useState('')
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => poolsApi.create({ name, description, ...(dailyQuota ? { daily_token_quota: Number(dailyQuota) } : {}), ...(monthlyQuota ? { monthly_token_quota: Number(monthlyQuota) } : {}), ...(allowedModels ? { allowed_models: allowedModels } : {}) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pools'] }); onClose() },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold mb-5 dark:text-white">Create Pool</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              value={name} onChange={e => setName(e.target.value)} placeholder="Team Pro"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              value={description} onChange={e => setDescription(e.target.value)} placeholder="Shared Pro accounts"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Daily token quota</label>
              <input type="number" min="0" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400" value={dailyQuota} onChange={e => setDailyQuota(e.target.value)} placeholder="0 = unlimited" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monthly token quota</label>
              <input type="number" min="0" className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400" value={monthlyQuota} onChange={e => setMonthlyQuota(e.target.value)} placeholder="0 = unlimited" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Allowed Models <span className="text-gray-400 dark:text-gray-500 font-normal">(comma-separated, optional)</span></label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              value={allowedModels} onChange={e => setAllowedModels(e.target.value)} placeholder="claude-sonnet-4-20250514, claude-opus-4-20250514"
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

export default function Pools() {
  const [showCreate, setShowCreate] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{title: string; message: string; onConfirm: () => void} | null>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()

  const { data: pools = [], isLoading } = useQuery({ queryKey: ['pools'], queryFn: poolsApi.list })

  const deleteMutation = useMutation({
    mutationFn: poolsApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['pools'] }); toast('Deleted!', true) },
    onError: (e: Error) => alert(e.message),
  })

  const resetMutation = useMutation({
    mutationFn: poolsApi.reset,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pools'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Pools</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Group Claude accounts and assign them to users.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600"
        >
          <Plus className="w-4 h-4" />
          New Pool
        </button>
      </div>

      {isLoading ? (
        <div className="text-gray-400 dark:text-gray-500">Loading...</div>
      ) : pools.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-12 text-center shadow-sm border border-gray-100 dark:border-gray-700">
          <p className="text-gray-400 dark:text-gray-500">No pools yet. Create one to group Claude accounts.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {pools.map(pool => {
            const accounts = pool.accounts ?? []
            const active    = accounts.filter(a => a.status === 'active').length
            const exhausted = accounts.filter(a => a.status === 'exhausted').length
            const error     = accounts.filter(a => a.status === 'error').length

            return (
              <div
                key={pool.id}
                className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700 cursor-pointer hover:border-brand-300 dark:hover:border-brand-600 transition-colors"
                onClick={() => navigate(`/pools/${pool.id}`)}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                      {pool.name}
                      <ChevronRight className="w-4 h-4 text-gray-400" />
                    </h2>
                    {pool.description && (
                      <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{pool.description}</p>
                    )}
                    {pool.allowed_models && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {pool.allowed_models.split(',').map(m => m.trim()).filter(Boolean).map(m => (
                          <span key={m} className="px-2 py-0.5 bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded text-xs font-mono">{m}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <button
                      title="Reset exhausted accounts"
                      onClick={() => resetMutation.mutate(pool.id)}
                      className="p-1.5 text-gray-400 hover:text-brand-500 rounded"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <button
                      title="Delete pool"
                      onClick={() => setConfirmAction({title: 'Delete Pool', message: `Delete pool "${pool.name}"?`, onConfirm: () => deleteMutation.mutate(pool.id)})}
                      className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-3">
                  <div className="flex items-center gap-2 text-sm">
                    <StatusDot status="active" />
                    <span className="text-gray-600 dark:text-gray-400">{active} active</span>
                  </div>
                  {exhausted > 0 && (
                    <div className="flex items-center gap-2 text-sm">
                      <StatusDot status="exhausted" />
                      <span className="text-gray-600 dark:text-gray-400">{exhausted} exhausted</span>
                    </div>
                  )}
                  {error > 0 && (
                    <div className="flex items-center gap-2 text-sm">
                      <StatusDot status="error" />
                      <span className="text-gray-600 dark:text-gray-400">{error} error</span>
                    </div>
                  )}
                  {accounts.length === 0 && (
                    <span className="text-sm text-gray-400 dark:text-gray-500">No accounts in this pool</span>
                  )}
                </div>

                {accounts.length > 0 && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                      <span>{active}/{accounts.length} active</span>
                      <span className={active === 0 ? 'text-red-500' : active < accounts.length ? 'text-amber-500' : 'text-green-500'}>
                        {Math.round(active / accounts.length * 100)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-1.5">
                      <div
                        className={`h-1.5 rounded-full ${active === 0 ? 'bg-red-500' : active < accounts.length ? 'bg-amber-500' : 'bg-green-500'}`}
                        style={{ width: `${(active / accounts.length) * 100}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showCreate && <CreatePoolModal onClose={() => setShowCreate(false)} />}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-semibold dark:text-white mb-2">{confirmAction.title}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{confirmAction.message}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmAction(null)} className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300">Cancel</button>
              <button onClick={() => { confirmAction.onConfirm(); setConfirmAction(null) }} className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
