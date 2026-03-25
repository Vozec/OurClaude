import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { auditApi, AuditEntry } from '../lib/api'

function ActionBadge({ action }: { action: string }) {
  const color = action.startsWith('delete') ? 'bg-red-100 text-red-700'
              : action.startsWith('create') ? 'bg-green-100 text-green-700'
              : action.startsWith('update') || action.startsWith('rotate') ? 'bg-yellow-100 text-yellow-700'
              : 'bg-gray-100 text-gray-600'
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {action}
    </span>
  )
}

export default function AuditLog() {
  const [page, setPage] = useState(1)
  const limit = 50

  const { data, isLoading } = useQuery({
    queryKey: ['audit', page],
    queryFn: () => auditApi.list({ page, limit }),
  })

  const totalPages = data ? Math.ceil(data.total / limit) : 1

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Audit Log</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Track all admin actions for accountability.</p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading...</div>
        ) : !data || data.logs.length === 0 ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">No audit entries yet.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Time</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Admin</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Action</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Target</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {data.logs.map((entry: AuditEntry) => (
                <tr key={entry.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-3 text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    {new Date(entry.created_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                    {entry.admin_username}
                  </td>
                  <td className="px-6 py-3">
                    <ActionBadge action={entry.action} />
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-500 dark:text-gray-400 font-mono">
                    {entry.target || '—'}
                  </td>
                  <td className="px-6 py-3 text-sm text-gray-400 dark:text-gray-500">
                    {entry.details || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <span>{data?.total ?? 0} total entries</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
            >
              Prev
            </button>
            <span>Page {page} / {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
