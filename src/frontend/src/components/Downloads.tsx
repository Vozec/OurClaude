import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { downloadsApi, DownloadLink, UserBinaryDownload } from '../lib/api'
import { Download, Link2, Trash2, Ban, Plus, Copy, Check, Monitor, Apple, Terminal, Key } from 'lucide-react'
import { useToast } from './ToastProvider'
import { copyToClipboard } from '../lib/clipboard'

const PLATFORM_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  'linux-amd64':   { label: 'Linux x86_64',   icon: Terminal },
  'linux-arm64':   { label: 'Linux ARM64',    icon: Terminal },
  'darwin-amd64':  { label: 'macOS x86_64',   icon: Apple },
  'darwin-arm64':  { label: 'macOS ARM (M1+)', icon: Apple },
  'windows-amd64': { label: 'Windows x86_64', icon: Monitor },
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  function handleCopy() {
    copyToClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button onClick={handleCopy} className="p-1 text-gray-400 hover:text-gray-600 transition-colors" title="Copy">
      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
    </button>
  )
}

interface CreateLinkModal {
  onClose: () => void
}

function CreateLinkModal({ onClose }: CreateLinkModal) {
  const qc = useQueryClient()
  const [platform, setPlatform] = useState('linux-amd64')
  const [label, setLabel] = useState('')
  const [maxDownloads, setMaxDownloads] = useState(1)
  const [expireHours, setExpireHours] = useState('')
  const [created, setCreated] = useState<DownloadLink | null>(null)

  const mutation = useMutation({
    mutationFn: downloadsApi.createLink,
    onSuccess: (link) => {
      qc.invalidateQueries({ queryKey: ['download-links'] })
      setCreated(link)
    },
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const expiresAt = expireHours
      ? new Date(Date.now() + parseInt(expireHours) * 3600_000).toISOString()
      : undefined
    mutation.mutate({
      label,
      platform,
      max_downloads: maxDownloads,
      expires_at: expiresAt,
    })
  }

  if (created) {
    const url = window.location.origin + downloadsApi.preAuthURL(created.token)
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
          <h2 className="text-lg font-semibold mb-4 text-green-700">Link created</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">Share this URL — it works only once (or up to your limit).</p>
          <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-900 border dark:border-gray-700 rounded-lg px-3 py-2 mb-4">
            <span className="text-sm text-gray-700 dark:text-gray-300 break-all flex-1 font-mono">{url}</span>
            <CopyButton text={url} />
          </div>
          <button onClick={onClose} className="w-full btn-primary">Done</button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-4 dark:text-white">Generate pre-auth download link</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Platform</label>
            <select
              value={platform}
              onChange={e => setPlatform(e.target.value)}
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white"
            >
              {Object.entries(PLATFORM_LABELS).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Label (optional)</label>
            <input
              value={label}
              onChange={e => setLabel(e.target.value)}
              placeholder="e.g. Alice's laptop"
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Max downloads (0 = unlimited)</label>
            <input
              type="number"
              min={0}
              value={maxDownloads}
              onChange={e => setMaxDownloads(parseInt(e.target.value) || 0)}
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Expires in hours (empty = never)</label>
            <input
              type="number"
              min={1}
              value={expireHours}
              onChange={e => setExpireHours(e.target.value)}
              placeholder="e.g. 24"
              className="w-full border dark:border-gray-600 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
            />
          </div>
          {mutation.error && (
            <p className="text-sm text-red-600">{(mutation.error as Error).message}</p>
          )}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 border dark:border-gray-600 rounded-lg px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending} className="flex-1 btn-primary">
              {mutation.isPending ? 'Creating…' : 'Create link'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function Downloads() {
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{title: string; message: string; onConfirm: () => void} | null>(null)
  const toast = useToast()

  const { data: platforms = [] } = useQuery({
    queryKey: ['platforms'],
    queryFn: downloadsApi.listPlatforms,
  })

  const { data: links = [] } = useQuery({
    queryKey: ['download-links'],
    queryFn: downloadsApi.listLinks,
  })

  const { data: binaryDownloads = [] } = useQuery({
    queryKey: ['binary-downloads'],
    queryFn: downloadsApi.listBinaryDownloads,
  })

  const revokeMutation = useMutation({
    mutationFn: downloadsApi.revokeLink,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['download-links'] }),
  })

  const deleteMutation = useMutation({
    mutationFn: downloadsApi.deleteLink,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['download-links'] }); toast('Deleted!', true) },
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Downloads</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Download the <code className="text-sm bg-gray-100 dark:bg-gray-700 dark:text-gray-300 px-1 rounded">ourclaude</code> client binary or generate shareable pre-auth links.</p>
      </div>

      {/* Direct downloads (admin-auth) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b dark:border-gray-700">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Download className="w-4 h-4" /> Direct download
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Requires admin session.</p>
        </div>
        <div className="divide-y dark:divide-gray-700">
          {Object.entries(PLATFORM_LABELS).map(([key, { label, icon: Icon }]) => {
            const info = platforms.find(p => p.platform === key)
            const available = info?.available ?? false
            return (
              <div key={key} className="flex items-center justify-between px-6 py-3">
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 text-gray-400 dark:text-gray-500" />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{label}</span>
                  {!available && (
                    <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">not built</span>
                  )}
                </div>
                <a
                  href={available ? downloadsApi.downloadURL(key) : undefined}
                  className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg transition-colors ${
                    available
                      ? 'bg-brand-50 text-brand-700 hover:bg-brand-100'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-400 cursor-not-allowed pointer-events-none'
                  }`}
                >
                  <Download className="w-3.5 h-3.5" />
                  Download
                </a>
              </div>
            )
          })}
        </div>
      </div>

      {/* Pre-auth links */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b dark:border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
              <Link2 className="w-4 h-4" /> Pre-auth download links
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Shareable links that don't require a login.</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> New link
          </button>
        </div>

        {links.length === 0 ? (
          <div className="px-6 py-10 text-center text-gray-400 dark:text-gray-500 text-sm">No links yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3 text-left">Label / Platform</th>
                <th className="px-6 py-3 text-left">URL</th>
                <th className="px-6 py-3 text-left">Downloads</th>
                <th className="px-6 py-3 text-left">Expires</th>
                <th className="px-6 py-3 text-left">Status</th>
                <th className="px-6 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {links.map(link => {
                const url = window.location.origin + downloadsApi.preAuthURL(link.token)
                const expired = link.expires_at ? new Date(link.expires_at) < new Date() : false
                const exhausted = link.max_downloads > 0 && link.downloads >= link.max_downloads
                const status = link.revoked ? 'revoked' : expired ? 'expired' : exhausted ? 'exhausted' : 'active'
                return (
                  <tr key={link.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                    <td className="px-6 py-3">
                      <p className="font-medium text-gray-800 dark:text-gray-100">{link.label || <span className="text-gray-400 dark:text-gray-500 italic">no label</span>}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">{PLATFORM_LABELS[link.platform]?.label ?? link.platform}</p>
                    </td>
                    <td className="px-6 py-3">
                      <div className="flex items-center gap-1 max-w-xs">
                        <span className="font-mono text-xs text-gray-500 dark:text-gray-400 truncate">{url}</span>
                        <CopyButton text={url} />
                      </div>
                    </td>
                    <td className="px-6 py-3 text-gray-600 dark:text-gray-400">
                      {link.downloads}{link.max_downloads > 0 ? ` / ${link.max_downloads}` : ''}
                    </td>
                    <td className="px-6 py-3 text-gray-500 dark:text-gray-400 text-xs">
                      {link.expires_at ? new Date(link.expires_at).toLocaleString() : '—'}
                    </td>
                    <td className="px-6 py-3">
                      <StatusBadge status={status} />
                    </td>
                    <td className="px-6 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {!link.revoked && (
                          <button
                            onClick={() => revokeMutation.mutate(link.id)}
                            className="p-1.5 text-gray-400 hover:text-yellow-600 transition-colors"
                            title="Revoke"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                        <button
                          onClick={() => setConfirmAction({title: 'Delete Link', message: 'Delete this link?', onConfirm: () => deleteMutation.mutate(link.id)})}
                          className="p-1.5 text-gray-400 hover:text-red-600 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Binary download history */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border dark:border-gray-700 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b dark:border-gray-700">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100 flex items-center gap-2">
            <Key className="w-4 h-4" /> Binary download history
          </h2>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">Tracks which user downloaded which binary, identified by the embedded key.</p>
        </div>
        {binaryDownloads.length === 0 ? (
          <div className="px-6 py-10 text-center text-gray-400 dark:text-gray-500 text-sm">No binary downloads recorded yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-700 text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              <tr>
                <th className="px-6 py-3 text-left">User</th>
                <th className="px-6 py-3 text-left">Platform</th>
                <th className="px-6 py-3 text-left">Binary key</th>
                <th className="px-6 py-3 text-left">Downloaded at</th>
              </tr>
            </thead>
            <tbody className="divide-y dark:divide-gray-700">
              {binaryDownloads.map((dl: UserBinaryDownload) => (
                <tr key={dl.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-3 text-gray-800 dark:text-gray-100 font-medium">{dl.user?.name ?? `#${dl.user_id}`}</td>
                  <td className="px-6 py-3 text-gray-600 dark:text-gray-400">{PLATFORM_LABELS[dl.platform]?.label ?? dl.platform}</td>
                  <td className="px-6 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{dl.binary_key.slice(0, 8)}...</td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400 text-xs">{new Date(dl.downloaded_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Usage instructions */}
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-6">
        <h2 className="font-semibold text-gray-800 dark:text-gray-100 mb-3 flex items-center gap-2">
          <Terminal className="w-4 h-4" /> How to use ourclaude
        </h2>
        <ol className="space-y-3 text-sm text-gray-600 dark:text-gray-400">
          <li className="flex gap-2"><span className="font-bold text-gray-400">1.</span>
            <span>Download the binary for your platform, then make it executable:</span>
          </li>
          <li>
            <code className="block bg-gray-900 text-green-400 text-xs rounded-lg px-4 py-3 font-mono whitespace-pre">{`chmod +x ourclaude\nsudo mv ourclaude /usr/local/bin/ourclaude`}</code>
          </li>
          <li className="flex gap-2"><span className="font-bold text-gray-400">2.</span>
            <span>Login with your proxy token (find it in Users page):</span>
          </li>
          <li>
            <code className="block bg-gray-900 text-green-400 text-xs rounded-lg px-4 py-3 font-mono">{`ourclaude login ${window.location.origin} sk-proxy-xxxxx`}</code>
          </li>
          <li className="flex gap-2"><span className="font-bold text-gray-400">3.</span>
            <span>Use Claude through the proxy — all requests go through your server:</span>
          </li>
          <li>
            <code className="block bg-gray-900 text-green-400 text-xs rounded-lg px-4 py-3 font-mono">{`ourclaude "Write a hello world in Go"`}</code>
          </li>
        </ol>
      </div>

      {showCreate && <CreateLinkModal onClose={() => setShowCreate(false)} />}
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

function StatusBadge({ status }: { status: string }) {
  const classes: Record<string, string> = {
    active:    'bg-green-100 text-green-700',
    revoked:   'bg-red-100 text-red-700',
    expired:   'bg-gray-100 text-gray-600',
    exhausted: 'bg-yellow-100 text-yellow-700',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${classes[status] ?? 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}
