import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { poolsApi, accountsApi, Pool, Account, User } from '../lib/api'
import { ArrowLeft, Server, Users, Zap, AlertTriangle, CheckCircle, Link2Off } from 'lucide-react'

function fmtTokens(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return String(n)
}

function fmtCost(n: number) {
  if (!n || n === 0) return '—'
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

function AccountStatusBadge({ status }: { status: string }) {
  if (status === 'active') return <span className="flex items-center gap-1 text-green-600 dark:text-green-400 text-xs"><CheckCircle className="w-3.5 h-3.5" />Active</span>
  if (status === 'exhausted') return <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400 text-xs"><Zap className="w-3.5 h-3.5" />Exhausted</span>
  return <span className="flex items-center gap-1 text-red-600 dark:text-red-400 text-xs"><AlertTriangle className="w-3.5 h-3.5" />Error</span>
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

function AccountRow({ account, poolId }: { account: Account; poolId: number }) {
  const [showConfirm, setShowConfirm] = useState(false)
  const qc = useQueryClient()
  const { data: stats } = useQuery({
    queryKey: ['account-stats', account.id],
    queryFn: () => accountsApi.stats(account.id),
  })

  const unlinkMutation = useMutation({
    mutationFn: () => accountsApi.unlink(account.id, poolId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pool-stats', poolId] })
      qc.invalidateQueries({ queryKey: ['accounts'] })
    },
  })

  return (
    <>
      <tr className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750">
        <td className="px-5 py-3">
          <p className="text-sm font-medium text-gray-900 dark:text-white">{account.name}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Expires {new Date(account.expires_at).toLocaleDateString()}
          </p>
        </td>
        <td className="px-5 py-3"><AccountStatusBadge status={account.status} /></td>
        <td className="px-5 py-3 text-sm text-gray-600 dark:text-gray-400">
          {stats ? fmtTokens(stats.today.input_tokens + stats.today.output_tokens) : '—'}
        </td>
        <td className="px-5 py-3 text-sm text-gray-600 dark:text-gray-400">
          {stats ? fmtTokens(stats.week.input_tokens + stats.week.output_tokens) : '—'}
        </td>
        <td className="px-5 py-3 text-xs text-gray-400 dark:text-gray-500">
          {account.last_used_at ? new Date(account.last_used_at).toLocaleString() : '—'}
        </td>
        <td className="px-5 py-3 text-right">
          <button
            title="Unlink from pool"
            onClick={() => setShowConfirm(true)}
            disabled={unlinkMutation.isPending}
            className="p-1.5 text-gray-400 hover:text-purple-500 rounded disabled:opacity-50"
          >
            <Link2Off className="w-4 h-4" />
          </button>
        </td>
      </tr>
      {showConfirm && (
        <ConfirmModal
          title="Unlink account"
          message={`Remove "${account.name}" from this pool?`}
          confirmLabel="Unlink"
          onConfirm={() => { unlinkMutation.mutate(); setShowConfirm(false) }}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  )
}

export default function PoolDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const poolId = Number(id)

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ['pool-stats', poolId],
    queryFn: () => poolsApi.stats(poolId),
    enabled: !!poolId,
  })

  const { data: users = [], isLoading: usersLoading } = useQuery({
    queryKey: ['pool-users', poolId],
    queryFn: () => poolsApi.users(poolId),
    enabled: !!poolId,
  })

  const pool = statsData?.pool

  if (statsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    )
  }

  if (!pool) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 dark:text-gray-400">Pool not found.</p>
        <button onClick={() => navigate('/pools')} className="mt-4 text-brand-500 hover:underline text-sm">← Back to pools</button>
      </div>
    )
  }

  const accounts = pool.accounts ?? []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => navigate('/pools')}
          className="mt-1 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{pool.name}</h1>
          {pool.description && <p className="text-gray-500 dark:text-gray-400 mt-0.5">{pool.description}</p>}
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-400 dark:text-gray-500">
            {pool.daily_token_quota > 0 && <span>Daily quota: {fmtTokens(pool.daily_token_quota)}</span>}
            {pool.monthly_token_quota > 0 && <span>Monthly quota: {fmtTokens(pool.monthly_token_quota)}</span>}
          </div>
        </div>
      </div>

      {/* Stats cards */}
      {statsData && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatCard
            label="Today"
            requests={statsData.today.requests}
            input={statsData.today.input_tokens}
            output={statsData.today.output_tokens}
            cost={statsData.today.est_cost_usd}
          />
          <StatCard
            label="Last 7 days"
            requests={statsData.week.requests}
            input={statsData.week.input_tokens}
            output={statsData.week.output_tokens}
            cost={statsData.week.est_cost_usd}
          />
          <StatCard
            label="This month"
            requests={statsData.month.requests}
            input={statsData.month.input_tokens}
            output={statsData.month.output_tokens}
            cost={statsData.month.est_cost_usd}
          />
        </div>
      )}

      {/* Accounts */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
          <Server className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <h2 className="font-semibold text-gray-900 dark:text-white text-sm">{accounts.length} Account{accounts.length !== 1 ? 's' : ''}</h2>
        </div>
        {accounts.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400 dark:text-gray-500 text-sm">No accounts in this pool.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400 uppercase">
              <tr>
                <th className="px-5 py-2.5 text-left">Account</th>
                <th className="px-5 py-2.5 text-left">Status</th>
                <th className="px-5 py-2.5 text-left">Tokens today</th>
                <th className="px-5 py-2.5 text-left">Tokens this week</th>
                <th className="px-5 py-2.5 text-left">Last used</th>
                <th className="px-5 py-2.5 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acc: Account) => <AccountRow key={acc.id} account={acc} poolId={poolId} />)}
            </tbody>
          </table>
        )}
      </div>

      {/* Users */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
          <Users className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <h2 className="font-semibold text-gray-900 dark:text-white text-sm">
            {usersLoading ? '…' : users.length} User{users.length !== 1 ? 's' : ''} assigned
          </h2>
        </div>
        {users.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400 dark:text-gray-500 text-sm">No users assigned to this pool.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400 uppercase">
              <tr>
                <th className="px-5 py-2.5 text-left">Name</th>
                <th className="px-5 py-2.5 text-left">Status</th>
                <th className="px-5 py-2.5 text-left">Daily quota</th>
                <th className="px-5 py-2.5 text-left">Monthly quota</th>
                <th className="px-5 py-2.5 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u: User) => (
                <tr key={u.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750">
                  <td className="px-5 py-3 font-medium text-gray-900 dark:text-white">{u.name}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {u.active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400 text-xs">{u.daily_token_quota ? fmtTokens(u.daily_token_quota) : '∞'}</td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400 text-xs">{u.monthly_token_quota ? fmtTokens(u.monthly_token_quota) : '∞'}</td>
                  <td className="px-5 py-3 text-gray-400 dark:text-gray-500 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
