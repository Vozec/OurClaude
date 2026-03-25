import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { mcpApi, MCPServerConfig } from '../lib/api'
import { Plus, Trash2 } from 'lucide-react'
import { useToast } from './ToastProvider'

function CreateMCPModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [serverType, setServerType] = useState<'command' | 'http'>('command')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [env, setEnv] = useState('')
  const [error, setError] = useState('')
  const qc = useQueryClient()
  const toast = useToast()

  const mutation = useMutation({
    mutationFn: () => mcpApi.create({
      name,
      type: serverType,
      ...(serverType === 'command' ? { command, args: args || undefined } : { url }),
      env: env || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mcp-servers'] }); toast('MCP server added', true); onClose() },
    onError: (e: Error) => { setError(e.message); toast(e.message, false) },
  })

  const canSubmit = name && (serverType === 'command' ? command : url)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 w-full max-w-md shadow-2xl">
        <h2 className="text-lg font-semibold mb-5 dark:text-white">Add MCP Server</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Name</label>
            <input
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              value={name} onChange={e => setName(e.target.value)} placeholder="my-mcp-server"
            />
          </div>
          <div className="flex gap-2 mb-4">
            <button onClick={() => setServerType('command')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${serverType === 'command' ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'}`}>
              Command
            </button>
            <button onClick={() => setServerType('http')}
              className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition-colors ${serverType === 'http' ? 'border-brand-500 bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300' : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'}`}>
              HTTP
            </button>
          </div>
          {serverType === 'command' ? (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Command</label>
                <input
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                  value={command} onChange={e => setCommand(e.target.value)} placeholder="npx -y @mcp/server"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Args <span className="text-gray-400 dark:text-gray-500 font-normal">(optional, space-separated)</span>
                </label>
                <input
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                  value={args} onChange={e => setArgs(e.target.value)} placeholder="--port 3001 --verbose"
                />
              </div>
            </>
          ) : (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">URL</label>
              <input
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                value={url} onChange={e => setUrl(e.target.value)} placeholder="https://mcp.example.com/sse"
              />
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Env <span className="text-gray-400 dark:text-gray-500 font-normal">(optional, KEY=VALUE per line)</span>
            </label>
            <textarea
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              rows={2}
              value={env} onChange={e => setEnv(e.target.value)} placeholder="API_KEY=xxx"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
            className="flex-1 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50"
          >
            {mutation.isPending ? 'Adding...' : 'Add Server'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function MCPServers() {
  const [showCreate, setShowCreate] = useState(false)
  const [confirmAction, setConfirmAction] = useState<{title: string; message: string; onConfirm: () => void} | null>(null)
  const qc = useQueryClient()
  const toast = useToast()

  const { data: servers = [], isLoading } = useQuery({ queryKey: ['mcp-servers'], queryFn: mcpApi.list })

  const deleteMutation = useMutation({
    mutationFn: (s: MCPServerConfig) => mcpApi.delete(s.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mcp-servers'] }); toast('Deleted!', true) },
    onError: (e: Error) => toast(e.message, false),
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">MCP Servers</h1>
          <p className="text-gray-500 dark:text-gray-400 mt-1">Manage Model Context Protocol server configurations.</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600"
        >
          <Plus className="w-4 h-4" />
          Add Server
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">Loading...</div>
        ) : servers.length === 0 ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500">No MCP servers configured.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700">
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Name</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Type</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Command / URL</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Args</th>
                <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Created</th>
                <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {servers.map(s => (
                <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-700">
                  <td className="px-6 py-3 font-medium text-gray-900 dark:text-white">{s.name}</td>
                  <td className="px-6 py-3">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${s.type === 'http' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-gray-100 dark:bg-gray-600 text-gray-600 dark:text-gray-300'}`}>
                      {s.type === 'http' ? 'HTTP' : 'CMD'}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400 font-mono text-xs">{s.type === 'http' ? s.url : s.command}</td>
                  <td className="px-6 py-3 text-gray-500 dark:text-gray-400 font-mono text-xs">{s.type === 'http' ? '-' : (s.args || '-')}</td>
                  <td className="px-6 py-3 text-gray-400 dark:text-gray-500">{new Date(s.created_at).toLocaleDateString()}</td>
                  <td className="px-6 py-3 text-right">
                    <button
                      onClick={() => setConfirmAction({title: 'Delete MCP Server', message: `Delete MCP server "${s.name}"?`, onConfirm: () => deleteMutation.mutate(s)})}
                      className="p-1.5 text-gray-400 hover:text-red-500 rounded"
                      title="Delete server"
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

      {showCreate && <CreateMCPModal onClose={() => setShowCreate(false)} />}
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
