import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { usersApi, User, UserStats, Account } from '../lib/api'
import { ArrowLeft, Copy, Check, Trash2, Power, RotateCcw, Clock, Gauge } from 'lucide-react'
import { useToast } from './ToastProvider'
import { copyToClipboard } from '../lib/clipboard'

function fmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return String(n)
}

function CopyToken({ token }: { token: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    copyToClipboard(token)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="flex items-center gap-2">
      <code className="text-xs bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-2 py-1 rounded font-mono">
        {token.slice(0, 20)}...
      </code>
      <button onClick={copy} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  )
}

function StatCard({ label, requests, input, output }: {
  label: string; requests: number; input: number; output: number
}) {
  return (
    <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
      <p className="text-xs text-gray-400 dark:text-gray-500 uppercase mb-1">{label}</p>
      <p className="text-lg font-bold text-gray-900 dark:text-white">{requests.toLocaleString()} <span className="text-xs font-normal text-gray-400">reqs</span></p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
        <span className="text-blue-600 dark:text-blue-400 font-medium">{fmt(input)}</span> in /
        <span className="text-purple-600 dark:text-purple-400 font-medium ml-1">{fmt(output)}</span> out
      </p>
    </div>
  )
}

function ConfirmModal({ title, message, confirmLabel, onConfirm, onCancel, danger }: {
  title: string; message: string; confirmLabel?: string
  onConfirm: () => void; onCancel: () => void; danger?: boolean
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
        <h3 className="text-lg font-semibold dark:text-white mb-2">{title}</h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300">Cancel</button>
          <button onClick={onConfirm} className={`flex-1 px-4 py-2 text-white rounded-lg text-sm ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-brand-500 hover:bg-brand-600'}`}>
            {confirmLabel ?? 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function UserDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const userId = Number(id)

  const [confirmAction, setConfirmAction] = useState<{
    title: string; message: string; confirmLabel: string; danger: boolean; action: () => void
  } | null>(null)

  // Fetch user list and find this one
  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
  })

  const user = users.find((u: User) => u.id === userId)

  // Stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['user-stats', userId],
    queryFn: () => usersApi.stats(userId),
    enabled: !!userId,
  })

  // Mutations
  const toggleMutation = useMutation({
    mutationFn: () => usersApi.update(userId, { active: !user?.active }),
    onSuccess: () => {
      toast(`User ${user?.active ? 'disabled' : 'enabled'}`, true)
      qc.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (e: Error) => toast(e.message, false),
  })

  const rotateMutation = useMutation({
    mutationFn: () => usersApi.rotateToken(userId),
    onSuccess: () => {
      toast('Token rotated', true)
      qc.invalidateQueries({ queryKey: ['users'] })
    },
    onError: (e: Error) => toast(e.message, false),
  })

  const deleteMutation = useMutation({
    mutationFn: () => usersApi.delete(userId),
    onSuccess: () => {
      toast('User deleted', true)
      qc.invalidateQueries({ queryKey: ['users'] })
      navigate('/users')
    },
    onError: (e: Error) => toast(e.message, false),
  })

  if (usersLoading || statsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 dark:text-gray-400">User not found.</p>
        <button onClick={() => navigate('/users')} className="mt-4 text-brand-500 hover:underline text-sm">
          ← Back to users
        </button>
      </div>
    )
  }

  const pools = user.pools ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => navigate('/users')}
          className="mt-1 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{user.name}</h1>
            <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${user.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
              {user.active ? 'Active' : 'Disabled'}
            </span>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            Created {new Date(user.created_at).toLocaleDateString()}
            {user.token_expires_at && <> &middot; Token expires {new Date(user.token_expires_at).toLocaleDateString()}</>}
          </p>
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <StatCard label="Today" requests={stats.today.requests} input={stats.today.input_tokens} output={stats.today.output_tokens} />
          <StatCard label="This week" requests={stats.week.requests} input={stats.week.input_tokens} output={stats.week.output_tokens} />
        </div>
      )}

      {/* Info section */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-5">
        {/* API Token */}
        <div>
          <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">API Token</h3>
          <CopyToken token={user.api_token} />
        </div>

        {/* Pools */}
        <div>
          <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Pools</h3>
          {pools.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500">No pools assigned.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {pools.map(p => (
                <Link
                  key={p.id}
                  to={`/pools/${p.id}`}
                  className="px-2.5 py-1 bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 rounded-lg text-xs font-medium hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
                >
                  {p.name}
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Quotas */}
        {(user.daily_token_quota > 0 || user.monthly_token_quota > 0 || user.monthly_budget_usd > 0) && (
          <div>
            <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Quotas</h3>
            <div className="space-y-1 text-sm text-gray-600 dark:text-gray-400">
              {user.daily_token_quota > 0 && (
                <p className="flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5" />Daily tokens: {fmt(user.daily_token_quota)}</p>
              )}
              {user.monthly_token_quota > 0 && (
                <p className="flex items-center gap-1.5"><Gauge className="w-3.5 h-3.5" />Monthly tokens: {fmt(user.monthly_token_quota)}</p>
              )}
              {user.monthly_budget_usd > 0 && (
                <p className="flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" />Monthly budget: ${user.monthly_budget_usd.toFixed(2)}</p>
              )}
            </div>
          </div>
        )}

        {/* Allowed models */}
        {user.allowed_models && (
          <div>
            <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Allowed Models</h3>
            <p className="text-sm font-mono text-gray-600 dark:text-gray-400">{user.allowed_models}</p>
          </div>
        )}

        {/* IP Whitelist */}
        {user.ip_whitelist && (
          <div>
            <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">IP Whitelist</h3>
            <p className="text-sm font-mono text-gray-600 dark:text-gray-400">{user.ip_whitelist}</p>
          </div>
        )}

        {/* Extra Headers */}
        {user.extra_headers && (
          <div>
            <h3 className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Extra Headers</h3>
            <p className="text-sm font-mono text-gray-600 dark:text-gray-400">{user.extra_headers}</p>
          </div>
        )}
      </div>

      {/* Owned accounts */}
      {stats && stats.accounts && stats.accounts.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Claude Accounts</h2>
          <div className="space-y-2">
            {stats.accounts.map((acc: Account) => {
              const expired = new Date(acc.expires_at) < new Date()
              return (
                <Link
                  key={acc.id}
                  to={`/accounts/${acc.id}`}
                  className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800 dark:text-gray-100">{acc.name}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500">
                      expires {expired ? <span className="text-red-500">expired</span> : new Date(acc.expires_at).toLocaleDateString()}
                    </p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${acc.status === 'active' ? 'bg-green-100 text-green-700' : acc.status === 'exhausted' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>
                    {acc.status}
                  </span>
                </Link>
              )
            })}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setConfirmAction({
              title: user.active ? 'Disable user' : 'Enable user',
              message: `${user.active ? 'Disable' : 'Enable'} "${user.name}"?`,
              confirmLabel: user.active ? 'Disable' : 'Enable',
              danger: false,
              action: () => toggleMutation.mutate(),
            })}
            disabled={toggleMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
          >
            <Power className="w-4 h-4" />
            {user.active ? 'Disable' : 'Enable'}
          </button>

          <button
            onClick={() => setConfirmAction({
              title: 'Rotate token',
              message: `Generate a new API token for "${user.name}"? The current token will stop working immediately.`,
              confirmLabel: 'Rotate',
              danger: false,
              action: () => rotateMutation.mutate(),
            })}
            disabled={rotateMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
          >
            <RotateCcw className={`w-4 h-4 ${rotateMutation.isPending ? 'animate-spin' : ''}`} />
            Rotate Token
          </button>

          <button
            onClick={() => setConfirmAction({
              title: 'Delete user',
              message: `Permanently delete "${user.name}"? This cannot be undone.`,
              confirmLabel: 'Delete',
              danger: true,
              action: () => deleteMutation.mutate(),
            })}
            disabled={deleteMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 rounded-lg text-sm hover:bg-red-100 dark:hover:bg-red-900/40 disabled:opacity-50 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      {/* Confirm modal */}
      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          danger={confirmAction.danger}
          onConfirm={() => { confirmAction.action(); setConfirmAction(null) }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  )
}
