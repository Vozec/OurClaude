import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { usersApi, poolsApi, teamsApi } from '../lib/api'

function ProgressBar({ used, limit, label }: { used: number; limit: number; label: string }) {
  if (limit <= 0) return null
  const pct = Math.min((used / limit) * 100, 100)
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-green-500'
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-0.5">
        <span>{label}</span>
        <span>{Math.round(pct)}%</span>
      </div>
      <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default function Quotas() {
  const [filter, setFilter] = useState<'all' | 'users' | 'pools' | 'teams'>('all')
  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list })
  const { data: pools = [] } = useQuery({ queryKey: ['pools'], queryFn: poolsApi.list })
  const { data: teams = [] } = useQuery({ queryKey: ['teams'], queryFn: teamsApi.list })

  // Build quota entries from entities that have limits set
  const entries: { type: string; name: string; dailyLimit: number; monthlyLimit: number; budgetLimit: number }[] = []
  if (filter === 'all' || filter === 'users') {
    users.filter(u => u.daily_token_quota > 0 || u.monthly_token_quota > 0 || u.monthly_budget_usd > 0).forEach(u => {
      entries.push({ type: 'User', name: u.name, dailyLimit: u.daily_token_quota, monthlyLimit: u.monthly_token_quota, budgetLimit: u.monthly_budget_usd })
    })
  }
  if (filter === 'all' || filter === 'pools') {
    pools.filter(p => p.daily_token_quota > 0 || p.monthly_token_quota > 0).forEach(p => {
      entries.push({ type: 'Pool', name: p.name, dailyLimit: p.daily_token_quota, monthlyLimit: p.monthly_token_quota, budgetLimit: 0 })
    })
  }
  if (filter === 'all' || filter === 'teams') {
    teams.filter(t => t.monthly_token_quota > 0 || t.monthly_budget_usd > 0).forEach(t => {
      entries.push({ type: 'Team', name: t.name, dailyLimit: 0, monthlyLimit: t.monthly_token_quota, budgetLimit: t.monthly_budget_usd })
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Quotas</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Token and budget quotas across users, pools, and teams.</p>
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value as typeof filter)}
          className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white">
          <option value="all">All</option>
          <option value="users">Users</option>
          <option value="pools">Pools</option>
          <option value="teams">Teams</option>
        </select>
      </div>
      {entries.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-8 text-center text-gray-400">
          No quotas configured. Set daily/monthly limits on users, pools, or teams.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((e, i) => (
            <div key={i} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
              <div className="flex items-center gap-2 mb-3">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${
                  e.type === 'User' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' :
                  e.type === 'Pool' ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400' :
                  'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400'
                }`}>{e.type}</span>
                <span className="font-medium text-gray-900 dark:text-white text-sm">{e.name}</span>
              </div>
              <div className="space-y-2">
                <ProgressBar used={0} limit={e.dailyLimit} label={`Daily: 0 / ${(e.dailyLimit/1000).toFixed(0)}K tokens`} />
                <ProgressBar used={0} limit={e.monthlyLimit} label={`Monthly: 0 / ${(e.monthlyLimit/1000).toFixed(0)}K tokens`} />
                {e.budgetLimit > 0 && <ProgressBar used={0} limit={e.budgetLimit} label={`Budget: $0 / $${e.budgetLimit.toFixed(0)}`} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
