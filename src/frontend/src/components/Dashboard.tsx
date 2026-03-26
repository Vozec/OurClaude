import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { statsApi, type OverviewStats } from '../lib/api'
import { MessageSquare, Zap, Users, Server, ArrowRight, AlertTriangle, DollarSign, Database, Info } from 'lucide-react'
import { Link } from 'react-router-dom'

function StatCard({ label, value, sub, icon: Icon, color, tooltip }: {
  label: string
  value: string | number
  sub?: string
  icon: React.ElementType
  color: string
  tooltip?: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1">
          {label}
          {tooltip && (
            <span className="relative group">
              <Info className="w-3.5 h-3.5 text-gray-400 cursor-help" />
              <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs text-white bg-gray-900 dark:bg-gray-700 rounded shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                {tooltip}
              </span>
            </span>
          )}
        </span>
        <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      {sub && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function StatusSummaryLine({ statuses }: { statuses: { status: string; count: number }[] }) {
  const colorMap: Record<string, string> = {
    active:    'text-green-600 dark:text-green-400',
    exhausted: 'text-yellow-600 dark:text-yellow-400',
    error:     'text-red-600 dark:text-red-400',
  }
  const dotMap: Record<string, string> = {
    active:    'bg-green-500',
    exhausted: 'bg-yellow-500',
    error:     'bg-red-500',
  }
  return (
    <p className="text-sm text-gray-700 dark:text-gray-300">
      {statuses.map((s, i) => (
        <span key={s.status}>
          {i > 0 && <span className="text-gray-400 mx-1">&middot;</span>}
          <span className={`inline-flex items-center gap-1 ${colorMap[s.status] ?? ''}`}>
            <span className={`w-1.5 h-1.5 rounded-full inline-block ${dotMap[s.status] ?? 'bg-gray-500'}`} />
            {s.count} {s.status}
          </span>
        </span>
      ))}
    </p>
  )
}

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: statsApi.overview,
    refetchInterval: 30_000,
  })

  const qc = useQueryClient()
  useEffect(() => {
    const es = new EventSource('/api/admin/stats/stream')
    es.onmessage = (e) => {
      try {
        const evt = JSON.parse(e.data)
        if (evt.type === 'usage') {
          qc.setQueryData(['stats', 'overview'], (old: OverviewStats | undefined) => {
            if (!old) return old
            return {
              ...old,
              total_requests: (old.total_requests || 0) + 1,
              total_input: (old.total_input || 0) + (evt.input_tokens || 0),
              total_output: (old.total_output || 0) + (evt.output_tokens || 0),
            }
          })
        }
      } catch {}
    }
    return () => es.close()
  }, [qc])

  if (isLoading || !data) {
    return <div className="animate-pulse space-y-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-32 bg-gray-200 rounded-xl" />
      ))}
    </div>
  }

  const totalTokens = data.total_input + data.total_output
  const estimatedCost = (data.total_input / 1_000_000) * 3.0 + (data.total_output / 1_000_000) * 15.0
  const isNewInstall = data.total_requests === 0 && data.total_users === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Overview of your Claude proxy.</p>
      </div>

      {/* Quota alert banner */}
      {(() => {
        const statuses = data.account_statuses ?? []
        const exhausted = statuses.find(s => s.status === 'exhausted')?.count ?? 0
        const errored = statuses.find(s => s.status === 'error')?.count ?? 0
        return (exhausted > 0 || errored > 0) ? (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-center gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <p className="text-sm text-amber-700 dark:text-amber-400">
              {exhausted > 0 && `${exhausted} account(s) exhausted`}
              {exhausted > 0 && errored > 0 && ' \u00b7 '}
              {errored > 0 && `${errored} account(s) in error`}
            </p>
          </div>
        ) : null
      })()}

      {/* Getting started */}
      {isNewInstall && (
        <div className="bg-brand-50 dark:bg-gray-800 border border-brand-100 dark:border-gray-700 rounded-xl p-6">
          <h2 className="text-base font-semibold text-brand-900 dark:text-white mb-4">Getting started</h2>
          <ol className="space-y-3">
            {[
              { step: 1, label: 'Create a pool', desc: 'Group your Claude accounts into a pool.', to: '/pools' },
              { step: 2, label: 'Add a Claude account', desc: 'Paste ~/.claude/.credentials.json to add an OAuth account.', to: '/accounts' },
              { step: 3, label: 'Create a user', desc: 'Generate an sk-proxy-* token for a user.', to: '/users' },
              { step: 4, label: 'Download ourclaude', desc: 'Get the CLI wrapper binary.', to: '/downloads' },
            ].map(({ step, label, desc, to }) => (
              <li key={step} className="flex items-start gap-3">
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-500 text-white text-xs flex items-center justify-center font-bold mt-0.5">{step}</span>
                <div className="flex-1">
                  <Link to={to} className="text-sm font-medium text-brand-700 dark:text-brand-400 hover:underline flex items-center gap-1">
                    {label} <ArrowRight className="w-3 h-3" />
                  </Link>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{desc}</p>
                </div>
              </li>
            ))}
            <li className="flex items-start gap-3">
              <span className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-500 text-white text-xs flex items-center justify-center font-bold mt-0.5">5</span>
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Run ourclaude login</p>
                <code className="text-xs bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-2 py-0.5 rounded font-mono">
                  ourclaude login http://your-server:3000 sk-proxy-xxxxx
                </code>
              </div>
            </li>
          </ol>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard
          label="Total Requests"
          value={data.total_requests.toLocaleString()}
          icon={MessageSquare}
          color="bg-brand-500"
        />
        <StatCard
          label="Total Tokens"
          value={totalTokens >= 1_000_000
            ? `${(totalTokens / 1_000_000).toFixed(1)}M`
            : totalTokens >= 1_000
            ? `${(totalTokens / 1_000).toFixed(1)}K`
            : totalTokens}
          sub={`↑ ${data.total_input.toLocaleString()} in  ↓ ${data.total_output.toLocaleString()} out`}
          icon={Zap}
          color="bg-purple-500"
        />
        <StatCard
          label="Est. Cost"
          value={estimatedCost < 0.01 && estimatedCost > 0 ? '<$0.01' : `$${estimatedCost.toFixed(2)}`}
          sub={data.projected_monthly_usd > 0
            ? `~$${data.projected_monthly_usd.toFixed(2)}/mo projected`
            : 'Based on $3/MTok in, $15/MTok out'}
          icon={DollarSign}
          color="bg-amber-500"
        />
        <StatCard
          label="Prompt Cache"
          value={(() => {
            const cr = data.cache_read_tokens ?? 0
            return cr >= 1_000_000 ? `${(cr / 1_000_000).toFixed(1)}M` : cr >= 1_000 ? `${(cr / 1_000).toFixed(1)}K` : cr
          })()}
          sub={(() => {
            const cr = data.cache_read_tokens ?? 0
            const savings = (cr / 1_000_000) * 2.70 // cache reads save ~$2.70/MTok vs full price
            return savings > 0 ? `~$${savings.toFixed(2)} saved via cache` : 'Cache read tokens'
          })()}
          icon={Database}
          color="bg-teal-500"
          tooltip="Cache reads save ~$2.70/MTok vs regular input tokens"
        />
        <StatCard
          label="Active Users"
          value={data.active_users}
          sub={`${data.total_users} total`}
          icon={Users}
          color="bg-blue-500"
        />
        <StatCard
          label="Claude Accounts"
          value={(data.account_statuses ?? []).reduce((s, a) => s + a.count, 0)}
          icon={Server}
          color="bg-emerald-500"
        />
      </div>

      {/* Account statuses */}
      {(data.account_statuses ?? []).length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Account Status</h2>
          <StatusSummaryLine statuses={data.account_statuses ?? []} />
        </div>
      )}

      {/* Quick usage summary */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Token Breakdown</h2>
        <div className="space-y-3">
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600 dark:text-gray-400">Input tokens</span>
              <span className="font-medium">{data.total_input.toLocaleString()}</span>
            </div>
            <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-400 rounded-full"
                style={{ width: totalTokens ? `${(data.total_input / totalTokens) * 100}%` : '0%' }}
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-sm mb-1">
              <span className="text-gray-600 dark:text-gray-400">Output tokens</span>
              <span className="font-medium">{data.total_output.toLocaleString()}</span>
            </div>
            <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-500 rounded-full"
                style={{ width: totalTokens ? `${(data.total_output / totalTokens) * 100}%` : '0%' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
