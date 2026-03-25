import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { QRCodeSVG } from 'qrcode.react'
import { authApi, settingsApi } from '../lib/api'
import { CheckCircle } from 'lucide-react'

function QRDisplay({ url }: { url: string }) {
  return (
    <div className="space-y-4">
      <div className="flex justify-center bg-white dark:bg-gray-700 p-4 rounded-xl border border-gray-200 dark:border-gray-600 w-fit">
        <QRCodeSVG value={url} size={180} />
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500">Compatible with Google Authenticator, Authy, 1Password, etc.</p>
    </div>
  )
}

function TOTPSection() {
  const qc = useQueryClient()
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: authApi.me })
  const [qrUrl, setQrUrl] = useState('')
  const [code, setCode] = useState('')
  const [phase, setPhase] = useState<'idle' | 'setup' | 'confirm'>('idle')
  const [error, setError] = useState('')

  const setupMutation = useMutation({
    mutationFn: authApi.totpSetup,
    onSuccess: (data) => {
      setQrUrl(data.qr_url)
      setPhase('confirm')
    },
    onError: (e: Error) => setError(e.message),
  })

  const enableMutation = useMutation({
    mutationFn: () => authApi.totpEnable(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      setPhase('idle')
      setCode('')
      setQrUrl('')
    },
    onError: (e: Error) => setError(e.message),
  })

  const disableMutation = useMutation({
    mutationFn: () => authApi.totpDisable(code),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      setCode('')
    },
    onError: (e: Error) => setError(e.message),
  })

  if (!me) return null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Two-Factor Authentication</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
        {me.totp_enabled ? 'TOTP is enabled on your account.' : 'Add an extra layer of security to your account.'}
      </p>

      {!me.totp_enabled && phase === 'idle' && (
        <button
          onClick={() => { setError(''); setupMutation.mutate() }}
          disabled={setupMutation.isPending}
          className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50"
        >
          {setupMutation.isPending ? 'Setting up...' : 'Enable 2FA'}
        </button>
      )}

      {phase === 'confirm' && (
        <div className="space-y-4">
          <QRDisplay url={qrUrl} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Enter the 6-digit code to confirm
            </label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              maxLength={6}
              className="w-40 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-center font-mono text-lg tracking-widest dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              placeholder="000000"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3">
            <button onClick={() => { setPhase('idle'); setCode('') }} className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:text-gray-300">
              Cancel
            </button>
            <button
              onClick={() => enableMutation.mutate()}
              disabled={code.length !== 6 || enableMutation.isPending}
              className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50"
            >
              {enableMutation.isPending ? 'Verifying...' : 'Confirm & Enable'}
            </button>
          </div>
        </div>
      )}

      {me.totp_enabled && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
            Two-factor authentication is active
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Enter your current TOTP code to disable 2FA
            </label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              maxLength={6}
              className="w-40 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 text-center font-mono text-lg tracking-widest dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
              placeholder="000000"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            onClick={() => { setError(''); disableMutation.mutate() }}
            disabled={code.length !== 6 || disableMutation.isPending}
            className="px-4 py-2 bg-red-500 text-white rounded-lg text-sm hover:bg-red-600 disabled:opacity-50"
          >
            {disableMutation.isPending ? 'Disabling...' : 'Disable 2FA'}
          </button>
        </div>
      )}
    </div>
  )
}

function PasswordSection() {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const mutation = useMutation({
    mutationFn: () => authApi.changePassword(current, next),
    onSuccess: () => { setSuccess(true); setCurrent(''); setNext(''); setConfirm('') },
    onError: (e: Error) => setError(e.message),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccess(false)
    if (next !== confirm) { setError('Passwords do not match'); return }
    if (next.length < 8) { setError('Password must be at least 8 characters'); return }
    mutation.mutate()
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Change Password</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">You'll be logged out after changing your password.</p>
      <form onSubmit={submit} className="space-y-4 max-w-sm">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Current password</label>
          <input type="password" value={current} onChange={e => setCurrent(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
            required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">New password</label>
          <input type="password" value={next} onChange={e => setNext(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
            minLength={8} required />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Confirm new password</label>
          <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
            required />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && <p className="text-sm text-green-600">Password changed! Redirecting to login...</p>}
        <button type="submit" disabled={mutation.isPending}
          className="px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50">
          {mutation.isPending ? 'Changing...' : 'Change Password'}
        </button>
      </form>
    </div>
  )
}

function DarkModeSection() {
  const isDark = document.documentElement.classList.contains("dark")
  const [dark, setDark] = useState(isDark)

  function toggle() {
    const next = !dark
    setDark(next)
    if (next) {
      document.documentElement.classList.add("dark")
      localStorage.setItem("theme", "dark")
    } else {
      document.documentElement.classList.remove("dark")
      localStorage.setItem("theme", "light")
    }
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm border border-gray-100 dark:border-gray-700">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Appearance</h2>
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">Toggle dark mode for the dashboard.</p>
      <button
        onClick={toggle}
        className="flex items-center gap-3 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300"
      >
        <span className="w-8 h-4 rounded-full relative transition-colors" style={{ background: dark ? "#4f6ef7" : "#d1d5db" }}>
          <span className="absolute top-0.5 w-3 h-3 rounded-full bg-white shadow transition-transform" style={{ transform: dark ? "translateX(18px)" : "translateX(2px)" }} />
        </span>
        {dark ? "Dark mode on" : "Dark mode off"}
      </button>
    </div>
  )
}

function SystemConfigSection() {
  const qc = useQueryClient()
  const { data: settings, isLoading } = useQuery({ queryKey: ['settings'], queryFn: settingsApi.list })
  const [local, setLocal] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (settings) setLocal(settings)
  }, [settings])

  const mutation = useMutation({
    mutationFn: () => settingsApi.update(local),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const set = (key: string, value: string) => setLocal(prev => ({ ...prev, [key]: value }))

  if (isLoading) return <div className="h-32 bg-gray-200 dark:bg-gray-700 rounded-xl animate-pulse" />

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">System Configuration</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">Runtime settings — changes apply immediately, no restart needed.</p>
        </div>
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-brand-500 text-white rounded-lg text-sm hover:bg-brand-600 disabled:opacity-50"
        >
          {saved ? <><CheckCircle className="w-4 h-4" /> Saved</> : mutation.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
      <div className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">System Prompt Injection</label>
          <textarea
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono text-sm h-24 resize-none dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
            value={local.system_prompt_inject ?? ''}
            onChange={e => set('system_prompt_inject', e.target.value)}
            placeholder="Prepended to system prompt on every proxy request..."
          />
          <p className="mt-1 text-xs text-gray-400">Leave empty to disable. Injected before the user's system prompt.</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Prompt Cache Injection</label>
            <button
              onClick={() => set('prompt_cache_inject', local.prompt_cache_inject === 'true' ? 'false' : 'true')}
              className={`w-full px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                local.prompt_cache_inject === 'true'
                  ? 'border-green-500 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                  : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400'
              }`}
            >
              {local.prompt_cache_inject === 'true' ? 'Enabled' : 'Disabled'}
            </button>
            <p className="mt-1 text-xs text-gray-400">Auto-inject cache_control on long prompts</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Response Cache TTL (seconds)</label>
            <input
              type="number"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white"
              value={local.response_cache_ttl ?? '0'}
              onChange={e => set('response_cache_ttl', e.target.value)}
              min={0}
            />
            <p className="mt-1 text-xs text-gray-400">0 = disabled. Caches identical non-streaming requests.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Rate Limit (RPM per user)</label>
            <input
              type="number"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 dark:bg-gray-700 dark:text-white"
              value={local.user_max_rpm ?? '0'}
              onChange={e => set('user_max_rpm', e.target.value)}
              min={0}
            />
            <p className="mt-1 text-xs text-gray-400">0 = unlimited. Max requests per minute per user.</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Settings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">Manage security and system configuration.</p>
      </div>
      <SystemConfigSection />
      <DarkModeSection />
      <TOTPSection />
      <PasswordSection />
    </div>
  )
}
