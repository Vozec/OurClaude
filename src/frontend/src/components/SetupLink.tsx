import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { setupApi, SetupLinkData } from '../lib/api'
import { Copy, Check, Terminal, Download, Moon, Sun, ChevronDown, ChevronRight, Zap } from 'lucide-react'
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

function RTKSection() {
  const [open, setOpen] = useState(false)
  const rtkCmd = 'curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh | bash && rtk init --global'
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
      <button onClick={() => setOpen(!open)} className="flex items-center gap-2 w-full text-left">
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        <Zap className="w-4 h-4 text-amber-500" />
        <span className="font-semibold text-gray-900 dark:text-white text-sm">Recommended: Install RTK (token optimizer)</span>
        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">optional</span>
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-500 dark:text-gray-400">
            <a href="https://github.com/rtk-ai/rtk" target="_blank" rel="noopener noreferrer" className="text-brand-500 hover:underline font-medium">RTK (Rust Token Killer)</a> optimizes Claude Code token usage by <strong>60-90%</strong> by filtering unnecessary context from CLI tool outputs. It runs as a transparent hook — no configuration needed after install.
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            RTK is <strong>included by default</strong> in the automatic install script above. To install manually:
          </p>
          <div className="bg-gray-900 dark:bg-gray-950 rounded-lg px-4 py-3 flex items-center gap-2">
            <code className="flex-1 text-xs text-green-400 font-mono break-all">{rtkCmd}</code>
            <CopyButton text={rtkCmd} />
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            After install, RTK hooks into Claude Code automatically. Run <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">rtk gain</code> to see token savings.
          </p>
        </div>
      )}
    </div>
  )
}

const detectedPlatform = (() => {
  const ua = navigator.userAgent.toLowerCase()
  if (ua.includes('mac')) return 'darwin-arm64'
  if (ua.includes('win')) return 'windows-amd64'
  return 'linux-amd64'
})()

function AutoInstall({ origin, token }: { origin: string; token: string }) {
  const [autoShare, setAutoShare] = useState(true)
  const url = autoShare ? `${origin}/api/install/${token}` : `${origin}/api/install/${token}?no-share=1`
  const cmd = `curl -sSL ${url} | sudo bash`
  const note = autoShare
    ? 'Includes auto-share: your local Claude account will be linked to the proxy automatically.'
    : 'Without auto-share: you will need to manually share your Claude account later.'
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">One command to download, install, and login:</p>
      <div className="bg-gray-900 dark:bg-gray-950 rounded-lg px-4 py-3 flex items-center gap-2">
        <code className="flex-1 text-xs text-green-400 font-mono break-all">{cmd}</code>
        <CopyButton text={cmd} />
      </div>
      <label className="flex items-center gap-2 mt-3 cursor-pointer">
        <input
          type="checkbox"
          checked={autoShare}
          onChange={e => setAutoShare(e.target.checked)}
          className="rounded border-gray-300 text-brand-500 focus:ring-brand-500"
        />
        <span className="text-xs text-gray-600 dark:text-gray-400">Auto-share Claude account with proxy</span>
      </label>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{note}</p>
    </div>
  )
}

function InstallTabs({ origin, token, data, loginCmd }: { origin: string; token: string; data: SetupLinkData; loginCmd: string }) {
  const [tab, setTab] = useState<'auto' | 'manual'>('auto')
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 mb-4">
      <div className="flex items-center gap-2 mb-4">
        <span className="w-6 h-6 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center shrink-0">1</span>
        <div className="flex items-center gap-1.5">
          <Download className="w-4 h-4 text-gray-500 dark:text-gray-400" />
          <span className="font-semibold text-gray-900 dark:text-white text-sm">Install the CLI</span>
        </div>
      </div>

      {/* Pill toggle */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-900 rounded-lg p-1 mb-4">
        <button
          onClick={() => setTab('auto')}
          className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === 'auto' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
        >
          Automatic
        </button>
        <button
          onClick={() => setTab('manual')}
          className={`flex-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${tab === 'manual' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
        >
          Manual
        </button>
      </div>

      {tab === 'auto' ? (
        <AutoInstall origin={origin} token={token} />
      ) : (
        <div className="space-y-4">
          {/* Step A: Download */}
          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Download the binary:</p>
            <div className="flex flex-wrap gap-2 mb-3">
              {PLATFORMS.map(p => {
                const dlPath = data.download_links[p.id] ?? `/api/downloads/${p.id}`
                const isDetected = p.id === detectedPlatform
                return (
                  <a
                    key={p.id}
                    href={`${origin}${dlPath}`}
                    className={`px-3 py-1.5 text-xs rounded-lg transition-colors font-medium ${
                      isDetected
                        ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300 border border-brand-500 ring-1 ring-brand-500'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-brand-50 hover:text-brand-700 dark:hover:bg-brand-900/30 dark:hover:text-brand-300'
                    }`}
                  >
                    {p.label}
                    {isDetected && <span className="ml-1 text-brand-500 text-xs font-normal">&larr; Your OS</span>}
                  </a>
                )
              })}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Or download with wget:</p>
            <div className="space-y-2">
              {PLATFORMS.map(p => {
                const dlPath = data.download_links[p.id] ?? `/api/downloads/${p.id}`
                const wgetCmd = `wget -O ourclaude ${origin}${dlPath} && chmod +x ourclaude`
                return (
                  <div key={p.id} className="bg-gray-900 dark:bg-gray-950 rounded-lg px-4 py-2 flex items-center gap-2">
                    <span className="text-xs text-gray-400 font-medium shrink-0 w-28">{p.label}:</span>
                    <code className="flex-1 text-xs text-green-400 font-mono break-all">{wgetCmd}</code>
                    <CopyButton text={wgetCmd} />
                  </div>
                )
              })}
            </div>
          </div>

          {/* Step B: Login */}
          <div>
            <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Then login to the proxy:</p>
            <div className="bg-gray-900 dark:bg-gray-950 rounded-lg px-4 py-3 flex items-center gap-2">
              <code className="flex-1 text-xs text-green-400 font-mono break-all">{loginCmd}</code>
              <CopyButton text={loginCmd} />
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
              Run this after <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">chmod +x ./ourclaude</code>
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default function SetupLink() {
  const { token } = useParams<{ token: string }>()
  const [data, setData] = useState<SetupLinkData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (localStorage.getItem('theme') !== 'light') {
      document.documentElement.classList.add('dark')
    }
  }, [])

  useEffect(() => {
    if (!token) { setError('Invalid link'); setLoading(false); return }
    setupApi.get(token)
      .then(d => { setData(d); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500" />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-4">
        <div className="text-center max-w-sm">
          <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
            <span className="text-red-500 text-xl font-bold">!</span>
          </div>
          <h1 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Link expired</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">This setup link has expired or is invalid. Ask an admin to generate a new one.</p>
        </div>
      </div>
    )
  }

  const origin = window.location.origin
  const loginCmd = `./ourclaude login ${origin} ${data.api_token}`

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
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Account ready!</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Welcome, <span className="font-medium text-gray-700 dark:text-gray-300">{data.name}</span>
              {data.pools && data.pools.length > 0 && (
                <span className="ml-1">
                  — pool{data.pools.length > 1 ? 's' : ''}: {data.pools.map(p => p.name).join(', ')}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Install tabs */}
        <InstallTabs origin={origin} token={token!} data={data} loginCmd={loginCmd} />

        {/* RTK recommendation */}
        <RTKSection />

        {/* API token */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase mb-2">Your API token</p>
          <div className="flex items-center bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2">
            <code className="flex-1 font-mono text-sm text-gray-800 dark:text-gray-200 break-all">{data.api_token}</code>
            <CopyButton text={data.api_token} />
          </div>
        </div>
      </div>
    </div>
  )
}
