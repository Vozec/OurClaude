import { useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { accountsApi, quotasApi, Account, AccountQuotaData } from '../lib/api'
import { ArrowLeft, CheckCircle, RefreshCw, Power, Trash2, AlertTriangle, Clock, XCircle } from 'lucide-react'
import { useToast } from './ToastProvider'

function fmtTokens(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return String(n)
}

function fmtCost(n: number) {
  if (!n || n === 0) return '\u2014'
  if (n < 0.01) return '<$0.01'
  return '$' + n.toFixed(2)
}

function StatCard({ label, requests, input, output, cost }: {
  label: string
  requests: number
  input: number
  output: number
  cost?: number
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">{label}</p>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{requests.toLocaleString()}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">requests</p>
        </div>
        <div>
          {cost !== undefined && <p className="text-xl font-bold text-amber-600">{fmtCost(cost)}</p>}
          <p className="text-xs text-gray-500 dark:text-gray-400">est. cost</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-blue-600 dark:text-blue-400">{fmtTokens(input)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">input tokens</p>
        </div>
        <div>
          <p className="text-sm font-semibold text-purple-600 dark:text-purple-400">{fmtTokens(output)}</p>
          <p className="text-xs text-gray-500 dark:text-gray-400">output tokens</p>
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'active') return <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs font-medium"><CheckCircle className="w-3.5 h-3.5" />Active</span>
  if (status === 'disabled') return <span className="flex items-center gap-1 text-gray-400 text-xs font-medium"><Clock className="w-3.5 h-3.5" />Disabled</span>
  if (status === 'exhausted') return <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400 text-xs font-medium"><AlertTriangle className="w-3.5 h-3.5" />Exhausted</span>
  return <span className="flex items-center gap-1 text-red-600 dark:text-red-400 text-xs font-medium"><XCircle className="w-3.5 h-3.5" />Error</span>
}

function QuotaBar({ label, pct, resets }: { label: string; pct: number; resets?: string }) {
  const color = pct > 80 ? 'bg-red-500' : pct > 50 ? 'bg-yellow-500' : 'bg-green-500'
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{label}</span>
        <span className="text-xs text-gray-500 dark:text-gray-400">{pct.toFixed(0)}%</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      {resets && (
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
          Resets {new Date(resets).toLocaleString()}
        </p>
      )}
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

export default function AccountDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const qc = useQueryClient()
  const accountId = Number(id)

  const [confirmAction, setConfirmAction] = useState<{
    title: string; message: string; confirmLabel: string; danger: boolean; action: () => void
  } | null>(null)

  // Fetch account list and find this one
  const { data: accounts = [], isLoading: accountsLoading } = useQuery({
    queryKey: ['accounts'],
    queryFn: accountsApi.list,
  })

  const account = accounts.find((a: Account) => a.id === accountId)

  // Stats
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['account-stats', accountId],
    queryFn: () => accountsApi.stats(accountId),
    enabled: !!accountId,
  })

  // Quota (only for OAuth, handle 404 gracefully)
  const { data: quota } = useQuery({
    queryKey: ['account-quota', accountId],
    queryFn: () => quotasApi.account(accountId).catch(() => null),
    enabled: !!account && account.account_type === 'oauth',
  })

  // Mutations
  const testMutation = useMutation({
    mutationFn: () => accountsApi.test(accountId),
    onSuccess: (res) => {
      toast(res.ok ? 'Account test passed' : `Test failed (HTTP ${res.status_code})`, res.ok)
      qc.invalidateQueries({ queryKey: ['accounts'] })
    },
    onError: (e: Error) => toast(e.message, false),
  })

  const refreshMutation = useMutation({
    mutationFn: () => accountsApi.refresh(accountId),
    onSuccess: () => {
      toast('Token refreshed', true)
      qc.invalidateQueries({ queryKey: ['accounts'] })
    },
    onError: (e: Error) => toast(e.message, false),
  })

  const toggleMutation = useMutation({
    mutationFn: () => accountsApi.toggle(accountId),
    onSuccess: (res) => {
      toast(`Account ${res.status}`, true)
      qc.invalidateQueries({ queryKey: ['accounts'] })
    },
    onError: (e: Error) => toast(e.message, false),
  })

  const deleteMutation = useMutation({
    mutationFn: () => accountsApi.delete(accountId),
    onSuccess: () => {
      toast('Account deleted', true)
      qc.invalidateQueries({ queryKey: ['accounts'] })
      navigate('/accounts')
    },
    onError: (e: Error) => toast(e.message, false),
  })

  if (accountsLoading || statsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    )
  }

  if (!account) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 dark:text-gray-400">Account not found.</p>
        <button onClick={() => navigate('/accounts')} className="mt-4 text-brand-500 hover:underline text-sm">
          ← Back to accounts
        </button>
      </div>
    )
  }

  const isOAuth = account.account_type === 'oauth'
  const pools = account.pools ?? []
  const quotaData = quota as AccountQuotaData | null | undefined

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => navigate('/accounts')}
          className="mt-1 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{account.name}</h1>
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${isOAuth ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'}`}>
              {isOAuth ? 'OAuth' : 'API Key'}
            </span>
            <StatusBadge status={account.status} />
          </div>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-400 dark:text-gray-500">
            <span>Expires {new Date(account.expires_at).toLocaleDateString()}</span>
            {account.last_used_at && <span>Last used {new Date(account.last_used_at).toLocaleString()}</span>}
          </div>
          {account.last_error && (
            <p className="mt-2 text-xs text-red-500">{account.last_error}</p>
          )}
        </div>
      </div>

      {/* Stats cards */}
      {stats && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            label="Today"
            requests={stats.today.requests}
            input={stats.today.input_tokens}
            output={stats.today.output_tokens}
            cost={stats.today.est_cost_usd}
          />
          <StatCard
            label="Last 7 days"
            requests={stats.week.requests}
            input={stats.week.input_tokens}
            output={stats.week.output_tokens}
            cost={stats.week.est_cost_usd}
          />
          <StatCard
            label="Total"
            requests={stats.total.requests}
            input={stats.total.input_tokens}
            output={stats.total.output_tokens}
            cost={stats.total.est_cost_usd}
          />
        </div>
      )}

      {/* Quota bars (OAuth only) */}
      {isOAuth && quotaData && !quotaData.error && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Claude.ai Quota</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <QuotaBar label="5-hour usage" pct={quotaData.five_hour_pct} resets={quotaData.five_hour_resets} />
            <QuotaBar label="7-day usage" pct={quotaData.seven_day_pct} resets={quotaData.seven_day_resets} />
            {quotaData.opus_pct !== undefined && (
              <QuotaBar label="Opus" pct={quotaData.opus_pct} resets={quotaData.opus_resets} />
            )}
            {quotaData.sonnet_pct !== undefined && (
              <QuotaBar label="Sonnet" pct={quotaData.sonnet_pct} resets={quotaData.sonnet_resets} />
            )}
          </div>
          {quotaData.extra_enabled && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Extra usage: {quotaData.extra_used ?? 0} / {quotaData.extra_limit ?? '?'}
            </p>
          )}
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Updated {new Date(quotaData.updated_at).toLocaleString()}
          </p>
        </div>
      )}

      {/* Pools */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Pools</h2>
        {pools.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">Not assigned to any pool.</p>
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

      {/* Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">Actions</h2>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
          >
            <CheckCircle className="w-4 h-4" />
            {testMutation.isPending ? 'Testing...' : 'Test'}
          </button>

          {isOAuth && (
            <button
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
              {refreshMutation.isPending ? 'Refreshing...' : 'Refresh Token'}
            </button>
          )}

          <button
            onClick={() => setConfirmAction({
              title: account.status === 'disabled' ? 'Enable account' : 'Disable account',
              message: `${account.status === 'disabled' ? 'Enable' : 'Disable'} "${account.name}"?`,
              confirmLabel: account.status === 'disabled' ? 'Enable' : 'Disable',
              danger: false,
              action: () => toggleMutation.mutate(),
            })}
            disabled={toggleMutation.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg text-sm hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
          >
            <Power className="w-4 h-4" />
            {account.status === 'disabled' ? 'Enable' : 'Disable'}
          </button>

          <button
            onClick={() => setConfirmAction({
              title: 'Delete account',
              message: `Permanently delete "${account.name}"? This cannot be undone.`,
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
