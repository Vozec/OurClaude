import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { invitesApi } from '../lib/api'
import { Copy, Check, Terminal, Download, Moon, Sun } from 'lucide-react'
import { copyToClipboard } from '../lib/clipboard'

function CopyButton({ text, className = '' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { copyToClipboard(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className={`shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 ${className}`}
    >
      {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
    </button>
  )
}

function DarkToggle() {
  const [dark, setDark] = useState(document.documentElement.classList.contains('dark'))
  function toggle() {
    const next = !dark
    setDark(next)
    if (next) { document.documentElement.classList.add('dark'); localStorage.setItem('theme', 'dark') }
    else { document.documentElement.classList.remove('dark'); localStorage.setItem('theme', 'light') }
  }
  return (
    <div className="flex items-center gap-2">
      <Moon className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
      <button
        onClick={toggle}
        title={dark ? 'Light mode' : 'Dark mode'}
        className={`relative inline-flex w-9 h-5 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${dark ? 'bg-brand-500' : 'bg-gray-300'}`}
      >
        <span className={`inline-block w-4 h-4 rounded-full bg-white shadow transform transition-transform duration-200 ${dark ? 'translate-x-4' : 'translate-x-0'}`} />
      </button>
      <Sun className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
    </div>
  )
}

const PLATFORMS = [
  { id: 'linux-amd64',   label: 'Linux x64' },
  { id: 'linux-arm64',   label: 'Linux ARM64' },
  { id: 'darwin-amd64',  label: 'macOS x64' },
  { id: 'darwin-arm64',  label: 'macOS ARM (M1/M2)' },
  { id: 'windows-amd64', label: 'Windows x64' },
]

function SuccessScreen({ name, apiToken, downloadLinks = {} }: {
  name: string
  apiToken: string
  downloadLinks?: Record<string, string>
}) {
  const origin = window.location.origin
  const loginCmd = `./ourclaude login ${origin} ${apiToken}`

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="max-w-xl mx-auto pt-12">
        {/* Header */}
        <div className="flex justify-end mb-6">
          <DarkToggle />
        </div>

        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900 flex items-center justify-center shrink-0">
            <Check className="w-5 h-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Account created!</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Welcome, <span className="font-medium text-gray-700 dark:text-gray-300">{name}</span></p>
          </div>
        </div>

        {/* Step 1: Download */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
            <div className="flex items-center gap-1.5">
              <Download className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <span className="font-semibold text-gray-900 dark:text-white text-sm">Download the CLI</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map(p => {
              const dlPath = downloadLinks[p.id] ?? `/api/downloads/${p.id}`
              return (
                <a
                  key={p.id}
                  href={`${origin}${dlPath}`}
                  className="px-3 py-1.5 text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-900/30 dark:hover:text-brand-300 transition-colors font-medium"
                >
                  {p.label}
                </a>
              )
            })}
          </div>
        </div>

        {/* Step 2: Login */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-6 h-6 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center shrink-0">2</span>
            <div className="flex items-center gap-1.5">
              <Terminal className="w-4 h-4 text-gray-500 dark:text-gray-400" />
              <span className="font-semibold text-gray-900 dark:text-white text-sm">Login to the proxy</span>
            </div>
          </div>
          <div className="bg-gray-900 dark:bg-gray-950 rounded-lg px-4 py-3 flex items-center gap-2">
            <code className="flex-1 text-xs text-green-400 font-mono break-all">{loginCmd}</code>
            <CopyButton text={loginCmd} />
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Run this after <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">chmod +x ./ourclaude</code></p>
        </div>

        {/* API token */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Your API token — save it, won't be shown again</p>
          <div className="flex items-center bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
            <code className="flex-1 font-mono text-sm text-gray-800 dark:text-gray-200 break-all">{apiToken}</code>
            <CopyButton text={apiToken} />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function InviteUse() {
  const { token: urlToken } = useParams<{ token?: string }>()
  const [token, setToken] = useState(urlToken ?? '')
  const [name, setName] = useState('')
  const [result, setResult] = useState<{ name: string; api_token: string; download_links?: Record<string, string> } | null>(null)

  // Initialize dark mode (self-contained, outside Layout)
  useEffect(() => {
    if (localStorage.getItem('theme') !== 'light') {
      document.documentElement.classList.add('dark')
    }
  }, [])

  const mutation = useMutation({
    mutationFn: () => invitesApi.use({ token, name }),
    onSuccess: (data) => setResult(data),
  })

  if (result) {
    return <SuccessScreen name={result.name} apiToken={result.api_token} downloadLinks={result.download_links} />
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-end mb-4">
          <DarkToggle />
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-2xl p-8 shadow-xl">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1">Join OurClaude</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-6">Enter your invite token and choose a name to get your API token.</p>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Invite token</label>
              <input
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                value={token}
                onChange={e => setToken(e.target.value)}
                placeholder="Paste your invite token here"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Your name</label>
              <input
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-sm dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Alice"
                onKeyDown={e => e.key === 'Enter' && !mutation.isPending && token && name && mutation.mutate()}
              />
            </div>
            {mutation.isError && (
              <p className="text-sm text-red-600">{(mutation.error as Error).message}</p>
            )}
          </div>

          <button
            onClick={() => mutation.mutate()}
            disabled={!token || !name || mutation.isPending}
            className="mt-6 w-full px-4 py-2.5 bg-brand-500 text-white rounded-lg text-sm font-medium hover:bg-brand-600 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Creating account...' : 'Create account'}
          </button>
        </div>
      </div>
    </div>
  )
}
