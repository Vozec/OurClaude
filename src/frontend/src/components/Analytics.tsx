import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { statsApi, DayStat } from '../lib/api'
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend
} from 'recharts'
import { Download, Zap, Info } from 'lucide-react'

const COLORS = ['#4f6ef7', '#a855f7', '#10b981', '#f59e0b', '#ef4444', '#06b6d4']

function fmtCost(n: number) {
  if (n === 0) return '—'
  if (n < 0.01) return '<$0.01'
  return '$' + n.toFixed(2)
}

function fmtTokens(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return String(n)
}

const MODEL_PRICE: Record<string, [number, number]> = {
  'claude-opus-4':     [15.0, 75.0],
  'claude-sonnet-4':   [3.0,  15.0],
  'claude-haiku-4':    [0.80, 4.0],
  'claude-3-5-sonnet': [3.0,  15.0],
  'claude-3-5-haiku':  [0.80, 4.0],
  'claude-3-opus':     [15.0, 75.0],
  'claude-3-sonnet':   [3.0,  15.0],
  'claude-3-haiku':    [0.25, 1.25],
}

function estimateCostPerDay(day: DayStat): number {
  // Use average pricing (sonnet-4 as fallback)
  const [inp, out] = [3.0, 15.0]
  return (day.input_tokens / 1e6) * inp + (day.output_tokens / 1e6) * out
}

type Tab = 'tokens' | 'requests' | 'cost'

export default function Analytics() {
  const [tab, setTab] = useState<Tab>('tokens')
  const { data: overview } = useQuery({ queryKey: ['stats', 'overview'], queryFn: statsApi.overview })
  const { data: byDay }    = useQuery({ queryKey: ['stats', 'by-day'],   queryFn: statsApi.byDay })
  const { data: byUser }   = useQuery({ queryKey: ['stats', 'by-user'],  queryFn: statsApi.byUser })
  const { data: byModel }  = useQuery({ queryKey: ['stats', 'by-model'], queryFn: statsApi.byModel })
  const { data: latency }  = useQuery({ queryKey: ['stats', 'latency'],  queryFn: statsApi.latency })

  const totalCost = byModel?.reduce((s, m) => s + (m.estimated_cost_usd ?? 0), 0) ?? 0

  const cacheRead  = overview?.total_cache_read  ?? 0
  const cacheWrite = overview?.total_cache_write ?? 0
  const totalInput = overview?.total_input ?? 0
  // Cache hit rate: what fraction of input was served from cache
  const cacheHitRate = (cacheRead + totalInput) > 0
    ? Math.round(cacheRead / (cacheRead + totalInput) * 100)
    : 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Token usage across users and models.</p>
        </div>
        <div className="flex items-center gap-3">
          {totalCost > 0 && (
            <div className="px-4 py-2 bg-amber-50 border border-amber-200 rounded-lg text-sm">
              <span className="text-amber-600 font-medium">Est. total cost: </span>
              <span className="text-amber-800 font-bold">{fmtCost(totalCost)}</span>
            </div>
          )}
          <a
            href={statsApi.exportURL()}
            download="usage-export.csv"
            className="flex items-center gap-2 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300"
          >
            <Download className="w-4 h-4" />
            Export CSV
          </a>
        </div>
      </div>

      {/* Cache metrics banner */}
      {(cacheRead > 0 || cacheWrite > 0) && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl px-6 py-4">
          <div className="flex items-start gap-3">
            <Zap className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-sm text-emerald-700 dark:text-emerald-300">Prompt cache active</span>
                <span className="bg-emerald-100 dark:bg-emerald-900 text-emerald-800 dark:text-emerald-200 text-xs font-semibold px-2 py-0.5 rounded-full">
                  {cacheHitRate}% hit rate
                </span>
              </div>
              <div className="flex items-center gap-6 mt-1.5 text-sm flex-wrap">
                <span className="text-emerald-700 dark:text-emerald-300">
                  <span className="font-medium">{fmtTokens(cacheRead)}</span> from cache
                </span>
                <span className="text-emerald-700 dark:text-emerald-300">
                  <span className="font-medium">{fmtTokens(cacheWrite)}</span> written to cache
                </span>
                <div className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 text-xs">
                  <Info className="w-3 h-3" />
                  <span>Cache tokens are ~10× cheaper than regular input tokens — this is expected and efficient.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Evolution charts — tabbed */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-0">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Evolution — last 30 days</h2>
          <div className="flex rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600 text-xs">
            {(['tokens', 'requests', 'cost'] as Tab[]).map(t => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-3 py-1.5 font-medium capitalize transition-colors ${
                  tab === t
                    ? 'bg-brand-500 text-white'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="p-6 pt-4">
          {byDay && byDay.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              {tab === 'tokens' ? (
                <AreaChart data={byDay}>
                  <defs>
                    <linearGradient id="inputGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4f6ef7" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#4f6ef7" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="outputGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} />
                  <Tooltip formatter={(v: number) => [v.toLocaleString(), '']} labelFormatter={l => `Date: ${l}`} />
                  <Area type="monotone" dataKey="input_tokens"  stroke="#4f6ef7" fill="url(#inputGrad)"  name="Input" />
                  <Area type="monotone" dataKey="output_tokens" stroke="#a855f7" fill="url(#outputGrad)" name="Output" />
                  <Legend />
                </AreaChart>
              ) : tab === 'requests' ? (
                <LineChart data={byDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Requests']} labelFormatter={l => `Date: ${l}`} />
                  <Line type="monotone" dataKey="total_requests" stroke="#10b981" strokeWidth={2} dot={false} name="Requests" />
                </LineChart>
              ) : (
                <LineChart data={byDay.map(d => ({ ...d, cost: estimateCostPerDay(d) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v.toFixed(2)}`} />
                  <Tooltip formatter={(v: number) => [`$${v.toFixed(3)}`, 'Est. cost']} labelFormatter={l => `Date: ${l}`} />
                  <Line type="monotone" dataKey="cost" stroke="#f59e0b" strokeWidth={2} dot={false} name="Est. cost ($)" />
                </LineChart>
              )}
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center text-gray-400 dark:text-gray-500">No data yet</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By user */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Top Users by Tokens</h2>
          {byUser && byUser.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byUser.slice(0, 10)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, #f0f0f0)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} />
                  <YAxis type="category" dataKey="user_name" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip formatter={(v: number) => [v.toLocaleString(), '']} />
                  <Bar dataKey="input_tokens"  name="Input"  fill="#4f6ef7" radius={[0, 3, 3, 0]} />
                  <Bar dataKey="output_tokens" name="Output" fill="#a855f7" radius={[0, 3, 3, 0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 divide-y divide-gray-50 dark:divide-gray-700 text-xs">
                {byUser.slice(0, 10).map(u => (
                  <div key={u.user_id} className="flex items-center justify-between py-1.5 text-gray-500 dark:text-gray-400">
                    <span className="font-medium text-gray-700 dark:text-gray-300">{u.user_name}</span>
                    <span className="text-amber-600 font-medium">{fmtCost(u.estimated_cost_usd)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-40 flex items-center justify-center text-gray-400 dark:text-gray-500">No data yet</div>
          )}
        </div>

        {/* By model */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Requests by Model</h2>
          {byModel && byModel.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={byModel}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, #f0f0f0)" />
                  <XAxis dataKey="model" tick={{ fontSize: 10 }} tickFormatter={m => m.split('-').slice(-2).join('-')} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="total_requests" name="Requests" radius={[3, 3, 0, 0]}>
                    {byModel.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="mt-3 space-y-1">
                {byModel.map((m, i) => (
                  <div key={m.model} className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full inline-block" style={{ background: COLORS[i % COLORS.length] }} />
                      <span className="font-mono">{m.model || 'unknown'}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span>{m.total_requests.toLocaleString()} reqs</span>
                      <span className="text-amber-600 font-medium">{fmtCost(m.estimated_cost_usd)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div className="h-40 flex items-center justify-center text-gray-400 dark:text-gray-500">No data yet</div>
          )}
        </div>
      </div>
      {/* Latency chart */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-4">Request Latency (P50 / P95 / P99)</h2>
        {latency && latency.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={latency}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, #f0f0f0)" />
              <XAxis dataKey="model" tick={{ fontSize: 10 }} tickFormatter={m => m.split("-").slice(-2).join("-")} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}s` : `${v}ms`} />
              <Tooltip formatter={(v: number) => [`${v}ms`, ""]} />
              <Legend />
              <Bar dataKey="p50_ms" name="P50" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="p95_ms" name="P95" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              <Bar dataKey="p99_ms" name="P99" fill="#ef4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-40 flex items-center justify-center text-gray-400 dark:text-gray-500">No latency data yet</div>
        )}
      </div>
    </div>
  )
}
