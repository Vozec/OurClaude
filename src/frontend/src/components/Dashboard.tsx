import { useQuery } from '@tanstack/react-query'
import { statsApi } from '../lib/api'
import { MessageSquare, Zap, Users, Server, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

function StatCard({ label, value, sub, icon: Icon, color }: {
  label: string
  value: string | number
  sub?: string
  icon: React.ElementType
  color: string
}) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm font-medium text-gray-500 dark:text-gray-400">{label}</span>
        <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center`}>
          <Icon className="w-5 h-5 text-white" />
        </div>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      {sub && <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function StatusBadge({ status, count }: { status: string; count: number }) {
  const colors: Record<string, string> = {
    active:    'bg-green-100 text-green-700',
    exhausted: 'bg-yellow-100 text-yellow-700',
    error:     'bg-red-100 text-red-700',
  }
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${colors[status] ?? 'bg-gray-100 text-gray-700'}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        status === 'active' ? 'bg-green-500' :
        status === 'exhausted' ? 'bg-yellow-500' : 'bg-red-500'
      }`} />
      {count} {status}
    </span>
  )
}

export default function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['stats', 'overview'],
    queryFn: statsApi.overview,
    refetchInterval: 30_000,
  })

  if (isLoading || !data) {
    return <div className="animate-pulse space-y-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="h-32 bg-gray-200 rounded-xl" />
      ))}
    </div>
  }

  const totalTokens = data.total_input + data.total_output
  const isNewInstall = data.total_requests === 0 && data.total_users === 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Overview of your Claude proxy.</p>
      </div>

      {/* Getting started */}
      {isNewInstall && (
        <div className="bg-brand-50 dark:bg-gray-800 border border-brand-100 dark:border-gray-700 rounded-xl p-6">
          <h2 className="text-base font-semibold text-brand-900 dark:text-white mb-4">Getting started</h2>
          <ol className="space-y-3">
            {[
              { step: 1, label: 'Create a pool', desc: 'Group your Claude accounts into a pool.', to: '/pools' },
              { step: 2, label: 'Add a Claude account', desc: 'Paste ~/.claude/.credentials.json to add an OAuth account.', to: '/accounts' },
              { step: 3, label: 'Create a user', desc: 'Generate an sk-proxy-* token for a user.', to: '/users' },
              { step: 4, label: 'Download cl', desc: 'Get the CLI wrapper binary.', to: '/downloads' },
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
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Run cl login</p>
                <code className="text-xs bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-2 py-0.5 rounded font-mono">
                  cl login http://your-server:3000 sk-proxy-xxxxx
                </code>
              </div>
            </li>
          </ol>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
          <div className="flex flex-wrap gap-2">
            {(data.account_statuses ?? []).map(s => (
              <StatusBadge key={s.status} status={s.status} count={s.count} />
            ))}
          </div>
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
