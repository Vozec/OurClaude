import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { sessionsApi, AdminSession } from '../lib/api'
import { Trash2 } from 'lucide-react'
import { useToast } from './ToastProvider'

export default function Sessions() {
  const [confirmAction, setConfirmAction] = useState<{title: string; message: string; onConfirm: () => void} | null>(null)
  const qc = useQueryClient()
  const toast = useToast()

  const { data: sessions = [], isLoading } = useQuery({ queryKey: ['sessions'], queryFn: sessionsApi.list })

  const revokeMutation = useMutation({
    mutationFn: (s: AdminSession) => sessionsApi.revoke(s.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sessions'] }); toast('Deleted!', true) },
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Admin Sessions</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Active login sessions for admin accounts.</p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading...</div>
        ) : sessions.length === 0 ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">No active sessions.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Admin</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">IP</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">User-Agent</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Last used</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Expires</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {sessions.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{s.admin_username}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-500 dark:text-gray-400">{s.ip}</td>
                  <td className="px-4 py-2.5 text-gray-400 dark:text-gray-500 text-xs truncate max-w-[200px]">{s.user_agent}</td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{new Date(s.last_used_at).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{new Date(s.expires_at).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => setConfirmAction({title: 'Revoke Session', message: 'Revoke this session?', onConfirm: () => revokeMutation.mutate(s)})}
                      className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {confirmAction && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-sm shadow-2xl">
            <h3 className="text-lg font-semibold dark:text-white mb-2">{confirmAction.title}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">{confirmAction.message}</p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmAction(null)} className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300">Cancel</button>
              <button onClick={() => { confirmAction.onConfirm(); setConfirmAction(null) }} className="flex-1 px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600">Confirm</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
