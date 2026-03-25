import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { invitesApi, poolsApi, Invite, InviteCreated } from '../lib/api'
import { Plus, Trash2, Copy, Check } from 'lucide-react'

function CopyLink({ token, serverUrl }: { token: string; serverUrl: string }) {
  const [copied, setCopied] = useState(false)
  const link = `${serverUrl}/invite/${token}`
  return (
    <div className="flex items-center gap-2">
      <code className="text-xs bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-2 py-1 rounded font-mono break-all">{link}</code>
      <button
        onClick={() => { navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
        className="shrink-0 text-gray-400 hover:text-gray-600"
      >
        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  )
}

function CreateInviteModal({ onClose }: { onClose: () => void }) {
  const [label, setLabel]       = useState('')
  const [poolId, setPoolId]     = useState<string>('')
  const [hours, setHours]       = useState('72')
  const [created, setCreated]   = useState<InviteCreated | null>(null)
  const [error, setError]       = useState('')
  const qc = useQueryClient()

  const { data: pools = [] } = useQuery({ queryKey: ['pools'], queryFn: poolsApi.list })

  const mutation = useMutation({
    mutationFn: () => invitesApi.create({
      label,
      ...(poolId ? { pool_id: Number(poolId) } : {}),
      expires_in_hours: Number(hours),
    }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['invites'] })
      setCreated(data)
    },
    onError: (e: Error) => setError(e.message),
  })

  if (created) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-lg shadow-2xl">
          <h2 className="text-lg font-semibold mb-2 dark:text-white">Invite created</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">Share this token — it's only shown once.</p>
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 font-mono text-xs break-all mb-2 dark:text-gray-300">{created.token}</div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-5">
            Expires: {new Date(created.expires_at).toLocaleString()}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
            Share the invite link below with the recipient. They'll be prompted to enter their name and will get a proxy API token.
          </p>
          <div className="mb-5">
            <CopyLink token={created.token} serverUrl={window.location.origin} />
          </div>
          <button onClick={onClose} className="w-full px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600">
            Done
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold mb-5 dark:text-white">Create Invite</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Label (optional)</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              value={label} onChange={e => setLabel(e.target.value)} placeholder="Alice's invite"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Assign to pool (optional)</label>
            <select
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white"
              value={poolId} onChange={e => setPoolId(e.target.value)}
            >
              <option value="">No pool</option>
              {pools.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Expires in (hours)</label>
            <input
              type="number" min="1" max="8760"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white"
              value={hours} onChange={e => setHours(e.target.value)}
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="flex-1 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Invites() {
  const [showCreate, setShowCreate] = useState(false)
  const qc = useQueryClient()

  const { data: invites = [], isLoading } = useQuery({ queryKey: ['invites'], queryFn: invitesApi.list })

  const deleteMutation = useMutation({
    mutationFn: invitesApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invites'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Invites</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Send invite links so people can self-register as proxy users.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600"
        >
          <Plus className="w-4 h-4" />
          New Invite
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading...</div>
        ) : invites.length === 0 ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">No invites yet.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Label</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Pool</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Invite Link</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Expires</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {invites.map((invite: Invite) => {
                const expired = new Date(invite.expires_at) < new Date()
                return (
                  <tr key={invite.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900 dark:text-white">{invite.label || '—'}</td>
                    <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">{invite.pool?.name ?? '—'}</td>
                    <td className="px-6 py-4 max-w-xs">
                      {!invite.used_at && !expired
                        ? <CopyLink token={invite.token} serverUrl={window.location.origin} />
                        : <span className="text-xs text-gray-400 dark:text-gray-500">—</span>}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-400 dark:text-gray-500">
                      {new Date(invite.expires_at).toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      {invite.used_at ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">
                          Used by {invite.used_by}
                        </span>
                      ) : expired ? (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 text-red-600">Expired</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-700">Active</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        title="Delete"
                        onClick={() => { if (confirm('Delete this invite?')) deleteMutation.mutate(invite.id) }}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && <CreateInviteModal onClose={() => setShowCreate(false)} />}
    </div>
  )
}
