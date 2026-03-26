import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { webhooksApi, Webhook } from '../lib/api'
import { Plus, Trash2, ToggleLeft, ToggleRight, Copy, Check } from 'lucide-react'
import { useToast } from './ToastProvider'
import { copyToClipboard } from '../lib/clipboard'

const EVENT_OPTIONS = [
  { value: 'account.exhausted', label: 'Account exhausted (quota hit)' },
  { value: 'account.error',     label: 'Account error (request failed)' },
  { value: 'quota.warning',     label: 'Quota warning (80% of limit reached)' },
]

function CopySecret({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false)
  if (!secret) return <span className="text-gray-400 dark:text-gray-500 text-xs">hidden</span>
  return (
    <div className="flex items-center gap-1">
      <code className="text-xs bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-2 py-0.5 rounded font-mono">{secret.slice(0, 10)}...</code>
      <button onClick={() => { copyToClipboard(secret); setCopied(true); setTimeout(() => setCopied(false), 2000) }}>
        {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5 text-gray-400" />}
      </button>
    </div>
  )
}

function isDiscordURL(u: string) {
  return u.includes('discord.com/api/webhooks') || u.includes('discordapp.com/api/webhooks')
}

function CreateWebhookModal({ onClose }: { onClose: () => void }) {
  const [url, setUrl]         = useState('')
  const [events, setEvents]   = useState<string[]>(['account.exhausted', 'account.error'])
  const [secret, setSecret]   = useState('')
  const [createdSecret, setCreatedSecret] = useState<string | null>(null)
  const [error, setError]     = useState('')
  const qc = useQueryClient()

  function toggleEvent(e: string) {
    setEvents(prev => prev.includes(e) ? prev.filter(x => x !== e) : [...prev, e])
  }

  const mutation = useMutation({
    mutationFn: () => webhooksApi.create({ url, events: events.join(','), secret: secret || undefined }),
    onSuccess: (data: Webhook & { secret?: string }) => {
      qc.invalidateQueries({ queryKey: ['webhooks'] })
      if (data.secret) {
        setCreatedSecret(data.secret)
      } else {
        onClose()
      }
    },
    onError: (e: Error) => setError(e.message),
  })

  if (createdSecret) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
          <h2 className="text-lg font-semibold mb-2 dark:text-white">Webhook created</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">Save this secret — it will not be shown again.</p>
          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 font-mono text-sm break-all mb-5 dark:text-gray-300">{createdSecret}</div>
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
        <h2 className="text-lg font-semibold mb-5 dark:text-white">Create Webhook</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">URL</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              value={url} onChange={e => setUrl(e.target.value)} placeholder="https://example.com/webhook"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Events</label>
            <div className="space-y-2">
              {EVENT_OPTIONS.map(opt => (
                <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={events.includes(opt.value)}
                    onChange={() => toggleEvent(opt.value)}
                    className="w-4 h-4 text-brand-500 rounded"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">{opt.label}</span>
                </label>
              ))}
            </div>
          </div>
          {isDiscordURL(url) && (
            <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-lg text-xs text-indigo-700 dark:text-indigo-300">
              <span>🎮</span>
              <span>Discord webhook detected — payload will be formatted as an embed automatically.</span>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Secret <span className="text-gray-400 dark:text-gray-500 font-normal">(optional, for HMAC signature — not used for Discord)</span>
            </label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              value={secret} onChange={e => setSecret(e.target.value)} placeholder="mysecret"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300">Cancel</button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!url || events.length === 0 || mutation.isPending}
            className="flex-1 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50"
          >
            {mutation.isPending ? 'Creating...' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Webhooks() {
  const [showCreate, setShowCreate] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{title: string; message: string; onConfirm: () => void} | null>(null)
  const qc = useQueryClient()
  const toast = useToast()

  const { data: hooks = [], isLoading } = useQuery({ queryKey: ['webhooks'], queryFn: webhooksApi.list })

  const deleteMutation = useMutation({
    mutationFn: webhooksApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['webhooks'] }); toast('Deleted!', true) },
  })
  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => webhooksApi.update(id, { active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['webhooks'] }),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Webhooks</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">HTTP notifications when account events occur.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600"
        >
          <Plus className="w-4 h-4" />
          New Webhook
        </button>
      </div>

      <div className="text-xs text-gray-500 dark:text-gray-400 space-y-2">
        <p className="font-medium text-gray-600 dark:text-gray-300">Available events:</p>
        <ul className="list-disc list-inside space-y-1">
          <li><code>account.exhausted</code> — Quota hit (429)</li>
          <li><code>account.error</code> — Network/token failure</li>
          <li><code>quota.warning</code> — User at 80% of limit</li>
        </ul>
        <p>Payloads are signed with <code>X-Signature: sha256=...</code> when a secret is set. Discord webhook URLs are auto-detected and formatted as embeds.</p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading...</div>
        ) : hooks.length === 0 ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">No webhooks configured.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">URL</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Events</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Status</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {hooks.map((hook: Webhook) => (
                <tr key={hook.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-4 text-sm text-gray-700 dark:text-gray-300 font-mono max-w-xs truncate">{hook.url}</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {hook.events.split(',').map(e => (
                        <span key={e} className="px-2 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 rounded text-xs font-mono">{e.trim()}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${hook.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {hook.active ? 'Active' : 'Paused'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        title={hook.active ? 'Pause' : 'Activate'}
                        onClick={() => toggleMutation.mutate({ id: hook.id, active: !hook.active })}
                        className="p-1.5 text-gray-400 hover:text-brand-500 rounded"
                      >
                        {hook.active ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                      </button>
                      <button
                        title="Delete"
                        onClick={() => setConfirmAction({title: 'Delete Webhook', message: 'Delete this webhook?', onConfirm: () => deleteMutation.mutate(hook.id)})}
                        className="p-1.5 text-gray-400 hover:text-red-500 rounded"
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

      {showCreate && <CreateWebhookModal onClose={() => setShowCreate(false)} />}
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
