import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { quotasApi, poolsApi, AccountQuotaWithInfo, Pool } from '../lib/api'
import { AlertTriangle, CheckCircle, Clock, XCircle, RefreshCw } from 'lucide-react'
import { useToast } from './ToastProvider'

function UsageBar({ label, pct, resets, color }: { label: string; pct: number; resets?: string; color?: string }) {
  const barColor = color ?? (pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : pct >= 40 ? 'bg-blue-500' : 'bg-green-500')
  const textColor = pct >= 90 ? 'text-red-600 dark:text-red-400 font-semibold' : pct >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-600 dark:text-gray-400'
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">{label}</span>
        <span className={`text-xs ${textColor}`}>{pct}%{resets ? ` — ${formatReset(resets)}` : ''}</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
        <div className={`h-2.5 rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
    </div>
  )
}

function formatReset(iso: string): string {
  if (!iso) return ''
  try {
    const t = new Date(iso)
    const now = new Date()
    const diffMs = t.getTime() - now.getTime()
    if (diffMs <= 0) return 'resetting...'
    const hours = Math.floor(diffMs / 3600000)
    const mins = Math.floor((diffMs % 3600000) / 60000)
    if (hours < 1) return `resets in ${mins}m`
    if (hours < 5) return `resets in ${hours}h ${mins}m`
    return `resets ${t.toLocaleDateString()} ${t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
  } catch {
    return iso
  }
}

function StatusIcon({ pct }: { pct: number }) {
  if (pct >= 90) return <XCircle className="w-5 h-5 text-red-500" />
  if (pct >= 70) return <AlertTriangle className="w-5 h-5 text-amber-500" />
  if (pct >= 40) return <Clock className="w-5 h-5 text-blue-500" />
  return <CheckCircle className="w-5 h-5 text-green-500" />
}

function AccountQuotaCard({ q }: { q: AccountQuotaWithInfo }) {
  const maxPct = Math.max(q.five_hour_pct, q.seven_day_pct, q.opus_pct ?? 0, q.sonnet_pct ?? 0)

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border p-5 transition-colors ${
      maxPct >= 90 ? 'border-red-300 dark:border-red-800' :
      maxPct >= 70 ? 'border-amber-300 dark:border-amber-800' :
      'border-gray-200 dark:border-gray-700'
    }`}>
      <div className="flex items-start gap-3 mb-4">
        <StatusIcon pct={maxPct} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-gray-900 dark:text-white text-sm truncate">{q.account_name}</span>
            <span className={`px-1.5 py-0.5 rounded text-xs font-medium shrink-0 ${
              q.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
              q.status === 'exhausted' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' :
              q.status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' :
              'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
            }`}>{q.status}</span>
          </div>
          {(q.pools ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {q.pools!.map(p => (
                <span key={p.id} className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded text-xs">{p.name}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {q.error ? (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <p className="text-xs text-red-600 dark:text-red-400">{q.error}</p>
        </div>
      ) : (
        <div className="space-y-3">
          <UsageBar label="Session (5h)" pct={q.five_hour_pct} resets={q.five_hour_resets} />
          <UsageBar label="Weekly (7d)" pct={q.seven_day_pct} resets={q.seven_day_resets} />
          {q.opus_pct != null && (
            <UsageBar label="Opus (7d)" pct={q.opus_pct} resets={q.opus_resets} color={q.opus_pct >= 90 ? 'bg-red-500' : 'bg-purple-500'} />
          )}
          {q.sonnet_pct != null && (
            <UsageBar label="Sonnet (7d)" pct={q.sonnet_pct} resets={q.sonnet_resets} color={q.sonnet_pct >= 90 ? 'bg-red-500' : 'bg-indigo-500'} />
          )}
          {q.extra_enabled && q.extra_limit != null && q.extra_used != null && (
            <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700">
              <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400">
                <span>Extra credits</span>
                <span>${q.extra_used?.toFixed(2)} / ${q.extra_limit?.toFixed(2)}</span>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
        Updated {new Date(q.updated_at).toLocaleTimeString()}
      </p>
    </div>
  )
}

export default function Quotas() {
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning' | 'healthy'>('all')
  const [poolFilter, setPoolFilter] = useState<string>('')

  const { data: quotas = [], isLoading } = useQuery({
    queryKey: ['anthropic-quotas'],
    queryFn: quotasApi.all,
    refetchInterval: 60_000,
  })

  const { data: pools = [] } = useQuery({ queryKey: ['pools'], queryFn: poolsApi.list })

  const toast = useToast()
  const qc = useQueryClient()
  const refreshMutation = useMutation({
    mutationFn: quotasApi.refresh,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['anthropic-quotas'] }); toast('Quota refresh triggered', true) },
    onError: (e: Error) => toast('Refresh failed: ' + e.message, false),
  })

  // Filter logic
  const filtered = quotas.filter(q => {
    if (poolFilter) {
      const inPool = (q.pools ?? []).some(p => String(p.id) === poolFilter)
      if (!inPool) return false
    }
    const maxPct = Math.max(q.five_hour_pct, q.seven_day_pct, q.opus_pct ?? 0, q.sonnet_pct ?? 0)
    if (filter === 'critical') return maxPct >= 90
    if (filter === 'warning') return maxPct >= 70 && maxPct < 90
    if (filter === 'healthy') return maxPct < 70
    return true
  })

  // Summary stats
  const critical = quotas.filter(q => Math.max(q.five_hour_pct, q.seven_day_pct) >= 90).length
  const warning = quotas.filter(q => { const m = Math.max(q.five_hour_pct, q.seven_day_pct); return m >= 70 && m < 90 }).length
  const healthy = quotas.filter(q => Math.max(q.five_hour_pct, q.seven_day_pct) < 70).length
  const errored = quotas.filter(q => q.error).length

  // Pool averages
  const poolAverages = pools.map(p => {
    const poolQuotas = quotas.filter(q => (q.pools ?? []).some(pp => pp.id === p.id))
    if (poolQuotas.length === 0) return { pool: p, avgFive: 0, avgSeven: 0, count: 0 }
    const avgFive = Math.round(poolQuotas.reduce((s, q) => s + q.five_hour_pct, 0) / poolQuotas.length)
    const avgSeven = Math.round(poolQuotas.reduce((s, q) => s + q.seven_day_pct, 0) / poolQuotas.length)
    return { pool: p, avgFive, avgSeven, count: poolQuotas.length }
  }).filter(p => p.count > 0)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-48 animate-pulse" />
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Anthropic Quotas</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            Real-time usage quotas from Anthropic — session limits, weekly limits, per-model caps.
          </p>
        </div>
        <button
          onClick={() => refreshMutation.mutate()}
          disabled={refreshMutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${refreshMutation.isPending ? 'animate-spin' : ''}`} />
          {refreshMutation.isPending ? 'Refreshing...' : 'Refresh now'}
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <button onClick={() => setFilter(filter === 'critical' ? 'all' : 'critical')}
          className={`bg-white dark:bg-gray-800 rounded-xl border p-4 text-left transition-colors ${filter === 'critical' ? 'border-red-500 ring-1 ring-red-500' : 'border-gray-200 dark:border-gray-700'}`}>
          <div className="flex items-center gap-2 mb-1">
            <XCircle className="w-4 h-4 text-red-500" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Critical</span>
          </div>
          <p className="text-2xl font-bold text-red-600">{critical}</p>
        </button>
        <button onClick={() => setFilter(filter === 'warning' ? 'all' : 'warning')}
          className={`bg-white dark:bg-gray-800 rounded-xl border p-4 text-left transition-colors ${filter === 'warning' ? 'border-amber-500 ring-1 ring-amber-500' : 'border-gray-200 dark:border-gray-700'}`}>
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Warning</span>
          </div>
          <p className="text-2xl font-bold text-amber-600">{warning}</p>
        </button>
        <button onClick={() => setFilter(filter === 'healthy' ? 'all' : 'healthy')}
          className={`bg-white dark:bg-gray-800 rounded-xl border p-4 text-left transition-colors ${filter === 'healthy' ? 'border-green-500 ring-1 ring-green-500' : 'border-gray-200 dark:border-gray-700'}`}>
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle className="w-4 h-4 text-green-500" />
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Healthy</span>
          </div>
          <p className="text-2xl font-bold text-green-600">{healthy}</p>
        </button>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Errors</span>
          </div>
          <p className="text-2xl font-bold text-gray-400">{errored}</p>
        </div>
      </div>

      {/* Pool averages */}
      {poolAverages.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">Pool Averages</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {poolAverages.map(({ pool, avgFive, avgSeven, count }) => (
              <button key={pool.id} onClick={() => setPoolFilter(poolFilter === String(pool.id) ? '' : String(pool.id))}
                className={`bg-white dark:bg-gray-800 rounded-xl border p-4 text-left transition-colors ${poolFilter === String(pool.id) ? 'border-brand-500 ring-1 ring-brand-500' : 'border-gray-200 dark:border-gray-700'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-gray-900 dark:text-white text-sm">{pool.name}</span>
                  <span className="text-xs text-gray-400">{count} accounts</span>
                </div>
                <div className="space-y-1.5">
                  <UsageBar label="Avg session" pct={avgFive} />
                  <UsageBar label="Avg weekly" pct={avgSeven} />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {filtered.length} account{filtered.length !== 1 ? 's' : ''}
          {filter !== 'all' && ` (${filter})`}
          {poolFilter && ` in ${pools.find(p => String(p.id) === poolFilter)?.name}`}
        </span>
        {(filter !== 'all' || poolFilter) && (
          <button onClick={() => { setFilter('all'); setPoolFilter('') }}
            className="text-xs text-brand-500 hover:underline">Clear filters</button>
        )}
      </div>

      {/* Account cards */}
      {filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-400">
          {quotas.length === 0 ? 'No quota data yet — the poller will fetch data shortly.' : 'No accounts match the current filter.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered
            .sort((a, b) => Math.max(b.five_hour_pct, b.seven_day_pct) - Math.max(a.five_hour_pct, a.seven_day_pct))
            .map(q => <AccountQuotaCard key={q.account_id} q={q} />)}
        </div>
      )}
    </div>
  )
}
