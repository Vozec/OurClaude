import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { teamsApi, Team } from '../lib/api'
import { Plus, Trash2, Pencil } from 'lucide-react'
import { useToast } from './ToastProvider'

function TeamModal({ team, onClose }: { team?: Team; onClose: () => void }) {
  const [name, setName] = useState(team?.name ?? '')
  const [budget, setBudget] = useState(team ? String(team.monthly_budget_usd) : '')
  const [quota, setQuota] = useState(team ? String(team.monthly_token_quota) : '')
  const [error, setError] = useState('')
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        name,
        ...(budget ? { monthly_budget_usd: Number(budget) } : {}),
        ...(quota ? { monthly_token_quota: Number(quota) } : {}),
      }
      return team ? teamsApi.update(team.id, body) : teamsApi.create(body)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teams'] }); onClose() },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold mb-5 dark:text-white">{team ? 'Edit Team' : 'Create Team'}</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              value={name} onChange={e => setName(e.target.value)} placeholder="Engineering"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monthly budget (USD)</label>
              <input type="number" min="0" step="0.01"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                value={budget} onChange={e => setBudget(e.target.value)} placeholder="0 = unlimited"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Monthly token quota</label>
              <input type="number" min="0"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                value={quota} onChange={e => setQuota(e.target.value)} placeholder="0 = unlimited"
              />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!name || mutation.isPending}
            className="flex-1 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50"
          >
            {mutation.isPending ? 'Saving...' : team ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Teams() {
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Team | undefined>()
  const [confirmAction, setConfirmAction] = useState<{title: string; message: string; onConfirm: () => void} | null>(null)
  const qc = useQueryClient()
  const toast = useToast()

  const { data: teams = [], isLoading } = useQuery({ queryKey: ['teams'], queryFn: teamsApi.list })

  const deleteMutation = useMutation({
    mutationFn: (t: Team) => teamsApi.delete(t.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teams'] }); toast('Deleted!', true) },
    onError: (e: Error) => alert(e.message),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Teams</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Manage teams with budgets and token quotas.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600"
        >
          <Plus className="w-4 h-4" />
          New Team
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading...</div>
        ) : teams.length === 0 ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">No teams yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Monthly Budget</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Monthly Token Quota</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Created</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {teams.map(t => (
                <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{t.name}</td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400">
                    {t.monthly_budget_usd > 0 ? `$${t.monthly_budget_usd.toFixed(2)}` : 'Unlimited'}
                  </td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400">
                    {t.monthly_token_quota > 0 ? t.monthly_token_quota.toLocaleString() : 'Unlimited'}
                  </td>
                  <td className="px-6 py-3 text-gray-400 dark:text-gray-500">{new Date(t.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => setEditing(t)}
                        className="p-1.5 text-gray-400 hover:text-brand-500 rounded"
                        title="Edit team"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setConfirmAction({title: 'Delete Team', message: `Delete team "${t.name}"?`, onConfirm: () => deleteMutation.mutate(t)})}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                        title="Delete team"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && <TeamModal onClose={() => setShowCreate(false)} />}
      {editing && <TeamModal team={editing} onClose={() => setEditing(undefined)} />}
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
