import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { statsApi, DayStat, ModelDayStat } from '../lib/api'
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell, Legend
} from 'recharts'
import { Download, Zap, Info } from 'lucide-react'

const COLORS = ['#4f6ef7', '#a855f7', '#10b981', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#84cc16']
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

function fmtDuration(min: number) {
  if (min < 1) return '<1m'
  if (min >= 60) return `${(min / 60).toFixed(1)}h`
  return `${min.toFixed(0)}m`
}

function estimateCostPerDay(day: DayStat): number {
  const [inp, out] = [3.0, 15.0]
  return (day.input_tokens / 1e6) * inp + (day.output_tokens / 1e6) * out
}

function shortModel(name: string): string {
  return name
    .replace('claude-', '')
    .replace(/-\d{8}$/, '')  // remove date suffix
    .replace('-latest', '')
}

type Tab = 'tokens' | 'requests' | 'cost'

// Build stacked bar data: each day gets keys per model
function buildModelDayData(rows: ModelDayStat[], topModels: string[]) {
  const byDay: Record<string, Record<string, number>> = {}
  for (const r of rows) {
    if (!byDay[r.day]) byDay[r.day] = { day: r.day as unknown as number }
    const key = topModels.includes(r.model) ? r.model : 'other'
    byDay[r.day][key] = (byDay[r.day][key] ?? 0) + r.requests
  }
  return Object.values(byDay).sort((a, b) => String(a.day) < String(b.day) ? -1 : 1)
}

export default function Analytics() {
  const [tab, setTab] = useState<Tab>('tokens')
  const [days, setDays] = useState(30)
  const qc = useQueryClient()

  useEffect(() => {
    const es = new EventSource('/api/admin/stats/stream')
    let timeout: ReturnType<typeof setTimeout>
    es.onmessage = () => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ['stats'] })
      }, 5000)
    }
    return () => { es.close(); clearTimeout(timeout) }
  }, [qc])

  const { data: overview }     = useQuery({ queryKey: ['stats', 'overview'],            queryFn: statsApi.overview })
  const { data: byDay }        = useQuery({ queryKey: ['stats', 'by-day', days],        queryFn: () => statsApi.byDay(days) })
  const { data: byUser }       = useQuery({ queryKey: ['stats', 'by-user'],              queryFn: statsApi.byUser })
  const { data: byModel }      = useQuery({ queryKey: ['stats', 'by-model', days],       queryFn: () => statsApi.byModel(days) })
  const { data: latency }      = useQuery({ queryKey: ['stats', 'latency', days],        queryFn: () => statsApi.latency(days) })
  const { data: byModelDay }   = useQuery({ queryKey: ['stats', 'by-model-day', days],   queryFn: () => statsApi.byModelDay(days) })
  const { data: heatmapData }  = useQuery({ queryKey: ['stats', 'heatmap', days],  queryFn: () => statsApi.heatmap(days) })
  const { data: sessionData }  = useQuery({ queryKey: ['stats', 'sessions', days], queryFn: () => statsApi.sessions(days * 24) })

  const totalCost = byModel?.reduce((s, m) => s + (m.estimated_cost_usd ?? 0), 0) ?? 0

  const cacheRead  = overview?.total_cache_read  ?? 0
  const cacheWrite = overview?.total_cache_write ?? 0
  const totalInput = overview?.total_input ?? 0
  const cacheHitRate = (cacheRead + totalInput) > 0
    ? Math.round(cacheRead / (cacheRead + totalInput) * 100) : 0

  // Heatmap: build 7×24 matrix
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  let heatmapMax = 1
  if (heatmapData) {
    for (const p of heatmapData) {
      heatmap[p.day_of_week][p.hour_of_day] = p.count
      if (p.count > heatmapMax) heatmapMax = p.count
    }
  }

  // Model-day stacked bar
  const topModels = (byModel ?? []).slice(0, 5).map(m => m.model)
  const allModelKeys = [...topModels]
  const hasOther = (byModelDay ?? []).some(r => !topModels.includes(r.model))
  if (hasOther) allModelKeys.push('other')
  const modelDayBarData = byModelDay ? buildModelDayData(byModelDay, topModels) : []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Analytics</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Token usage across users and models.</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={days}
            onChange={e => setDays(Number(e.target.value))}
            className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white"
          >
            <option value={7}>Last 7 days</option>
            <option value={14}>Last 14 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          {totalCost > 0 && (
            <div className="px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-sm">
              <span className="text-amber-600 font-medium">Est. total cost: </span>
              <span className="text-amber-800 dark:text-amber-300 font-bold">{fmtCost(totalCost)}</span>
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
                  <span>Cache tokens are ~10× cheaper than regular input tokens.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Evolution charts — tabbed */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="flex items-center justify-between px-6 pt-5 pb-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Evolution — last {days} days</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Daily token usage, request count, and estimated cost over time.</p>
          </div>
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
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : String(v)} label={{ value: 'Tokens', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                  <Tooltip formatter={(v: number) => [v.toLocaleString(), '']} labelFormatter={l => `Date: ${l}`} />
                  <Area type="monotone" dataKey="input_tokens"  stroke="#4f6ef7" fill="url(#inputGrad)"  name="Input" />
                  <Area type="monotone" dataKey="output_tokens" stroke="#a855f7" fill="url(#outputGrad)" name="Output" />
                  <Legend />
                </AreaChart>
              ) : tab === 'requests' ? (
                <LineChart data={byDay}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} label={{ value: 'Requests', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                  <Tooltip formatter={(v: number) => [v.toLocaleString(), 'Requests']} labelFormatter={l => `Date: ${l}`} />
                  <Legend />
                  <Line type="monotone" dataKey="total_requests" stroke="#10b981" strokeWidth={2} dot={false} name="Requests" />
                </LineChart>
              ) : (
                <LineChart data={byDay.map(d => ({ ...d, cost: estimateCostPerDay(d) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `$${v.toFixed(2)}`} label={{ value: 'Cost ($)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                  <Tooltip formatter={(v: number) => [`$${v.toFixed(3)}`, 'Est. cost']} labelFormatter={l => `Date: ${l}`} />
                  <Legend />
                  <Line type="monotone" dataKey="cost" stroke="#f59e0b" strokeWidth={2} dot={false} name="Est. cost ($)" />
                </LineChart>
              )}
            </ResponsiveContainer>
          ) : (
            <div className="h-40 flex items-center justify-center text-gray-400 dark:text-gray-500">No data yet</div>
          )}
        </div>
      </div>

      {/* Model trends over time */}
      {modelDayBarData.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-6">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Model Trends — last {days} days</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-4">Stacked daily request volume broken down by model.</p>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={modelDayBarData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={d => String(d).slice(5)} />
              <YAxis tick={{ fontSize: 11 }} label={{ value: 'Requests', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
              <Tooltip labelFormatter={l => `Date: ${l}`} />
              <Legend formatter={(value) => shortModel(value)} />
              {allModelKeys.map((m, i) => (
                <Bar key={m} dataKey={m} name={m} stackId="a" fill={COLORS[i % COLORS.length]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* By user */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Top Users by Tokens</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-4">Input and output token consumption per user.</p>
          {byUser && byUser.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={byUser.slice(0, 10)} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, #f0f0f0)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}K` : v} label={{ value: 'Tokens', position: 'insideBottom', offset: -2, style: { fontSize: 11 } }} />
                  <YAxis type="category" dataKey="user_name" tick={{ fontSize: 11 }} width={80} />
                  <Tooltip formatter={(v: number) => [v.toLocaleString(), '']} />
                  <Legend />
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
          <h2 className="text-base font-semibold text-gray-900 dark:text-white">Requests by Model</h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-4">Total request distribution across models.</p>
          {byModel && byModel.length > 0 ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={byModel}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, #f0f0f0)" />
                  <XAxis dataKey="model" tick={{ fontSize: 10 }} tickFormatter={m => shortModel(m).split('-').slice(-2).join('-')} />
                  <YAxis tick={{ fontSize: 11 }} label={{ value: 'Requests', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
                  <Tooltip />
                  <Legend formatter={(value) => shortModel(value)} />
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
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Request Latency (P50 / P95 / P99)</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-4">Latency percentiles per model over the last {days} days.</p>
        {latency && latency.length > 0 ? (
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={latency}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, #f0f0f0)" />
              <XAxis dataKey="model" tick={{ fontSize: 10 }} tickFormatter={m => shortModel(m).split("-").slice(-2).join("-")} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(1)}s` : `${v}ms`} label={{ value: 'Latency (ms)', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }} />
              <Tooltip formatter={(v: number) => [`${v}ms`, ""]} />
              <Legend formatter={(value) => shortModel(value)} />
              <Bar dataKey="p50_ms" name="P50" fill="#10b981" radius={[3, 3, 0, 0]} />
              <Bar dataKey="p95_ms" name="P95" fill="#f59e0b" radius={[3, 3, 0, 0]} />
              <Bar dataKey="p99_ms" name="P99" fill="#ef4444" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-40 flex items-center justify-center text-gray-400 dark:text-gray-500">No latency data yet</div>
        )}
      </div>

      {/* Activity heatmap */}
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
        <h2 className="text-base font-semibold text-gray-900 dark:text-white">Activity Heatmap — last {days} days</h2>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 mb-4">Request volume by day of week and hour of day.</p>
        {heatmapData && heatmapData.length > 0 ? (
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              {/* Hour labels */}
              <div className="flex mb-1 ml-10">
                {Array.from({ length: 24 }, (_, h) => (
                  <div key={h} className="flex-1 text-center text-xs text-gray-400 dark:text-gray-500">
                    {h % 6 === 0 ? `${h}h` : ''}
                  </div>
                ))}
              </div>
              {/* Grid rows */}
              {DAYS.map((day, di) => (
                <div key={day} className="flex items-center mb-0.5">
                  <span className="w-10 text-xs text-gray-500 dark:text-gray-400 shrink-0">{day}</span>
                  {Array.from({ length: 24 }, (_, h) => {
                    const count = heatmap[di][h]
                    const intensity = count / heatmapMax
                    const opacity = count === 0 ? 0 : Math.max(0.1, intensity)
                    return (
                      <div
                        key={h}
                        className="flex-1 h-5 rounded-sm mx-px"
                        style={{
                          backgroundColor: count === 0
                            ? 'transparent'
                            : `rgba(79, 110, 247, ${opacity})`,
                          border: count === 0 ? '1px solid #e5e7eb' : 'none',
                        }}
                        title={`${day} ${h}:00 — ${count} req${count !== 1 ? 's' : ''}`}
                      />
                    )
                  })}
                </div>
              ))}
              <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                <span>Less</span>
                <div className="flex gap-0.5">
                  {[0.1, 0.3, 0.5, 0.7, 1.0].map(o => (
                    <div key={o} className="w-4 h-4 rounded" style={{ backgroundColor: `rgba(79, 110, 247, ${o})` }} />
                  ))}
                </div>
                <span>More</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-24 flex items-center justify-center text-gray-400 dark:text-gray-500">No activity data yet</div>
        )}
      </div>

      {/* Session analytics */}
      {sessionData && sessionData.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Session Analytics — last {days} days</h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Sessions detected by 30-minute inactivity gaps</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400 uppercase">
                <tr>
                  <th className="px-6 py-3 text-left">User</th>
                  <th className="px-6 py-3 text-right">Sessions</th>
                  <th className="px-6 py-3 text-right">Requests</th>
                  <th className="px-6 py-3 text-right">Avg duration</th>
                  <th className="px-6 py-3 text-right">Msg/session</th>
                  <th className="px-6 py-3 text-right">Tokens</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {sessionData.map(s => (
                  <tr key={s.user_id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{s.user_name}</td>
                    <td className="px-6 py-3 text-right text-gray-700 dark:text-gray-300 font-semibold">{s.session_count}</td>
                    <td className="px-6 py-3 text-right text-gray-500 dark:text-gray-400">{s.total_requests}</td>
                    <td className="px-6 py-3 text-right text-gray-500 dark:text-gray-400">{fmtDuration(s.avg_session_duration_min)}</td>
                    <td className="px-6 py-3 text-right text-gray-500 dark:text-gray-400">{s.avg_messages_per_session.toFixed(1)}</td>
                    <td className="px-6 py-3 text-right text-gray-500 dark:text-gray-400">{fmtTokens(s.total_input_tokens + s.total_output_tokens)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
