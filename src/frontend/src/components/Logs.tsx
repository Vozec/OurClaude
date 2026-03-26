import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { statsApi, usersApi, conversationsApi, UsageLog, ConversationDetail, ConversationMessage } from '../lib/api'
import { MessageSquare, Download, X } from 'lucide-react'

function statusColor(code: number) {
  if (code >= 200 && code < 300) return 'text-green-600 bg-green-50'
  if (code >= 400 && code < 500) return 'text-yellow-600 bg-yellow-50'
  return 'text-red-600 bg-red-50'
}

function fmt(n: number) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n)
}

function extractText(content: ConversationMessage['content']): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map(c => c.text ?? '').join('')
  }
  return ''
}

function ConversationPanel({ logId, onClose }: { logId: number; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['conversation', logId],
    queryFn: () => conversationsApi.get(logId),
  })

  function exportConversation() {
    if (!data) return
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `conversation-${logId}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-white dark:bg-gray-900 shadow-2xl flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">Conversation #{logId}</h2>
            {data && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">
                {data.user_name} · {data.model.split('-').slice(-3).join('-')} ·
                {' '}{fmt(data.input_tokens)} in / {fmt(data.output_tokens)} out
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {data && (
              <button
                onClick={exportConversation}
                title="Export conversation"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-600 dark:text-gray-300"
              >
                <Download className="w-3.5 h-3.5" />
                Export
              </button>
            )}
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600 rounded">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {isLoading && (
            <div className="text-center text-gray-400 dark:text-gray-500 py-12">Loading...</div>
          )}
          {data && data.messages && data.messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm whitespace-pre-wrap break-words ${
                msg.role === 'user'
                  ? 'bg-brand-500 text-white rounded-br-sm'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-bl-sm'
              }`}>
                <div className="text-xs font-medium mb-1 opacity-60 uppercase tracking-wide">
                  {msg.role}
                </div>
                {extractText(msg.content)}
              </div>
            </div>
          ))}
          {data && data.response && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-bl-sm px-4 py-3 text-sm whitespace-pre-wrap break-words bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200">
                <div className="text-xs font-medium mb-1 opacity-60 uppercase tracking-wide">
                  assistant
                </div>
                {data.response}
              </div>
            </div>
          )}
          {data && !data.messages && !data.response && (
            <div className="text-center text-gray-400 dark:text-gray-500 py-12">
              No conversation content captured for this request.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Logs() {
  const [page, setPage] = useState(1)
  const [userFilter, setUserFilter] = useState('')
  const [modelFilter, setModelFilter] = useState('')
  const [statusClass, setStatusClass] = useState('')
  const [endpointFilter, setEndpointFilter] = useState('')
  const [minLatency, setMinLatency] = useState('')
  const [live, setLive] = useState(false)
  const [liveList, setLiveList] = useState<UsageLog[]>([])
  const [viewConvId, setViewConvId] = useState<number | null>(null)
  const esRef = useRef<EventSource | null>(null)
  const limit = 50

  const { data: users = [] } = useQuery({ queryKey: ['users'], queryFn: usersApi.list })
  const { data, isLoading } = useQuery({
    queryKey: ['logs', page, userFilter, modelFilter, statusClass, endpointFilter],
    queryFn: () => statsApi.usage({
      page,
      limit,
      user_id: userFilter ? Number(userFilter) : undefined,
      model: modelFilter || undefined,
      status_class: statusClass || undefined,
      endpoint: endpointFilter || undefined,
    }),
    placeholderData: prev => prev,
  })

  const totalPages = data ? Math.ceil(data.total / limit) : 1

  useEffect(() => {
    if (!live) {
      esRef.current?.close()
      esRef.current = null
      return
    }
    const es = new EventSource('/api/admin/logs/stream', { withCredentials: true })
    esRef.current = es
    es.onmessage = (e) => {
      try {
        const log: UsageLog = JSON.parse(e.data)
        setLiveList(prev => [log, ...prev].slice(0, 100))
      } catch {}
    }
    return () => es.close()
  }, [live])

  const filteredLogs = minLatency
    ? (data?.logs ?? []).filter(l => l.latency_ms >= Number(minLatency))
    : (data?.logs ?? [])
  const displayedLogs = live ? liveList : filteredLogs

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Request Logs</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">
            {data ? `${data.total.toLocaleString()} total requests` : 'Loading...'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setLive(l => !l)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${live ? 'bg-red-50 text-red-700 border border-red-300 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800' : 'border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300'}`}
          >
            {live && <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />}
            {live ? 'Live' : 'Go Live'}
          </button>
          <select
            value={userFilter}
            onChange={e => { setUserFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All users</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input
            type="text"
            value={modelFilter}
            onChange={e => { setModelFilter(e.target.value); setPage(1) }}
            placeholder="Model filter"
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-40 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
          />
          <select
            value={statusClass}
            onChange={e => { setStatusClass(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white"
          >
            <option value="">All statuses</option>
            <option value="2xx">2xx</option>
            <option value="4xx">4xx</option>
            <option value="5xx">5xx</option>
          </select>
          <input
            type="text"
            value={endpointFilter}
            onChange={e => { setEndpointFilter(e.target.value); setPage(1) }}
            placeholder="Endpoint filter"
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-40 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
          />
          <input
            type="number"
            value={minLatency}
            onChange={e => { setMinLatency(e.target.value); setPage(1) }}
            placeholder="Min latency (ms)"
            className="px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-36 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
          />
          <a
            href={conversationsApi.exportURL()}
            download="conversations-export.json"
            className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300"
            title="Export all conversations"
          >
            <Download className="w-4 h-4" />
            Export convs
          </a>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading...</div>
        ) : !displayedLogs.length ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">No logs yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Time</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">User</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Model</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Endpoint</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">In</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Out</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Cache</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Latency</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Conv</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {displayedLogs.map(log => (
                <tr key={log.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 font-medium text-gray-800 dark:text-gray-100">
                    {log.user?.name ?? `#${log.user_id}`}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 font-mono text-xs">
                    {log.model ? log.model.split('-').slice(-2).join('-') : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-gray-400 dark:text-gray-500 font-mono text-xs truncate max-w-[160px]">
                    {log.endpoint}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{fmt(log.input_tokens)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-700 dark:text-gray-300">{fmt(log.output_tokens)}</td>
                  <td className="px-4 py-2.5 text-right text-gray-400 dark:text-gray-500 text-xs">
                    {log.cache_read > 0 || log.cache_write > 0
                      ? `r:${fmt(log.cache_read)} w:${fmt(log.cache_write)}`
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">
                    {log.latency_ms > 0
                      ? log.latency_ms >= 1000
                        ? `${(log.latency_ms / 1000).toFixed(1)}s`
                        : `${log.latency_ms}ms`
                      : '—'}
                    {log.ttft_ms > 0 && (
                      <span className="text-brand-400 ml-1" title="Time to first token">
                        ({log.ttft_ms}ms)
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-mono font-medium ${statusColor(log.status_code)}`}>
                      {log.status_code}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <button
                      title="View conversation"
                      onClick={() => setViewConvId(log.id)}
                      className="p-1 text-gray-300 hover:text-brand-500 dark:text-gray-600 dark:hover:text-brand-400 rounded transition-colors"
                    >
                      <MessageSquare className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && !live && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Page {page} of {totalPages}
            {data && <span className="ml-2 text-gray-400">— Showing {limit} of {data.total} logs</span>}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-3 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-sm disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {viewConvId !== null && (
        <ConversationPanel logId={viewConvId} onClose={() => setViewConvId(null)} />
      )}
    </div>
  )
}
