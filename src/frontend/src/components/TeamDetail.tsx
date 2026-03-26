import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { teamsApi, usersApi, Team, User } from '../lib/api'
import { ArrowLeft, Users, Pencil, Trash2, DollarSign, Hash } from 'lucide-react'
import { useToast } from './ToastProvider'

function fmtTokens(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return String(n)
}

function TeamModal({ team, onClose }: { team: Team; onClose: () => void }) {
  const [name, setName] = useState(team.name)
  const [budget, setBudget] = useState(String(team.monthly_budget_usd))
  const [quota, setQuota] = useState(String(team.monthly_token_quota))
  const [error, setError] = useState('')
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => teamsApi.update(team.id, {
      name,
      ...(budget ? { monthly_budget_usd: Number(budget) } : {}),
      ...(quota ? { monthly_token_quota: Number(quota) } : {}),
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teams'] }); qc.invalidateQueries({ queryKey: ['team', team.id] }); onClose() },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold mb-5 dark:text-white">Edit Team</h2>
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
            {mutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
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

export default function TeamDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const toast = useToast()
  const teamId = Number(id)

  const [showEdit, setShowEdit] = useState(false)
  const [showDelete, setShowDelete] = useState(false)

  const { data: teams = [], isLoading: teamsLoading } = useQuery({
    queryKey: ['teams'],
    queryFn: teamsApi.list,
  })

  const { data: allUsers = [], isLoading: usersLoading } = useQuery({
    queryKey: ['users'],
    queryFn: usersApi.list,
    enabled: !!teamId,
  })

  const team = teams.find((t: Team) => t.id === teamId)
  const members = allUsers.filter((u: User) => u.team_id === teamId)

  const deleteMutation = useMutation({
    mutationFn: () => teamsApi.delete(teamId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] })
      toast('Team deleted!', true)
      navigate('/teams')
    },
    onError: (e: Error) => toast(e.message, false),
  })

  if (teamsLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    )
  }

  if (!team) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500 dark:text-gray-400">Team not found.</p>
        <button onClick={() => navigate('/teams')} className="mt-4 text-brand-500 hover:underline text-sm">Back to teams</button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => navigate('/teams')}
          className="mt-1 p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{team.name}</h1>
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-400 dark:text-gray-500">
            <span>Created {new Date(team.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowEdit(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <Pencil className="w-4 h-4" />
            Edit
          </button>
          <button
            onClick={() => setShowDelete(true)}
            className="flex items-center gap-2 px-3 py-1.5 text-sm text-red-600 border border-red-300 dark:border-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20"
          >
            <Trash2 className="w-4 h-4" />
            Delete
          </button>
        </div>
      </div>

      {/* Budget & Quota info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center gap-2 mb-3">
            <DollarSign className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Monthly Budget</p>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {team.monthly_budget_usd > 0 ? `$${team.monthly_budget_usd.toFixed(2)}` : 'Unlimited'}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <div className="flex items-center gap-2 mb-3">
            <Hash className="w-4 h-4 text-gray-500 dark:text-gray-400" />
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">Monthly Token Quota</p>
          </div>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {team.monthly_token_quota > 0 ? fmtTokens(team.monthly_token_quota) : 'Unlimited'}
          </p>
        </div>
      </div>

      {/* Members */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
          <Users className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <h2 className="font-semibold text-gray-900 dark:text-white text-sm">
            {usersLoading ? '...' : members.length} Member{members.length !== 1 ? 's' : ''}
          </h2>
        </div>
        {members.length === 0 ? (
          <div className="px-5 py-8 text-center text-gray-400 dark:text-gray-500 text-sm">No members in this team.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs text-gray-500 dark:text-gray-400 uppercase">
              <tr>
                <th className="px-5 py-2.5 text-left">Name</th>
                <th className="px-5 py-2.5 text-left">Status</th>
                <th className="px-5 py-2.5 text-left">Daily Quota</th>
                <th className="px-5 py-2.5 text-left">Monthly Quota</th>
                <th className="px-5 py-2.5 text-left">Created</th>
              </tr>
            </thead>
            <tbody>
              {members.map((u: User) => (
                <tr key={u.id} className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800">
                  <td className="px-5 py-3 font-medium text-gray-900 dark:text-white">{u.name}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${u.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {u.active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400 text-xs">{u.daily_token_quota ? fmtTokens(u.daily_token_quota) : 'Unlimited'}</td>
                  <td className="px-5 py-3 text-gray-500 dark:text-gray-400 text-xs">{u.monthly_token_quota ? fmtTokens(u.monthly_token_quota) : 'Unlimited'}</td>
                  <td className="px-5 py-3 text-gray-400 dark:text-gray-500 text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showEdit && <TeamModal team={team} onClose={() => setShowEdit(false)} />}
      {showDelete && (
        <ConfirmModal
          title="Delete Team"
          message={`Are you sure you want to delete team "${team.name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={() => { deleteMutation.mutate(); setShowDelete(false) }}
          onCancel={() => setShowDelete(false)}
        />
      )}
    </div>
  )
}
