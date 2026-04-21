import { useState } from 'react'
import { useToast } from './ToastProvider'
import { CheckCircle, XCircle, Loader2, ExternalLink, Key } from 'lucide-react'
import { OAuthService, type OAuthCredentials } from './services/oauth.js'

type Step = 'idle' | 'authorizing' | 'exchanging' | 'success' | 'error'

export default function OAuthTest() {
  const toast = useToast()
  const [step, setStep] = useState<Step>('idle')
  const [oauth] = useState(() => new OAuthService())
  const [authUrl, setAuthUrl] = useState('')
  const [code, setCode] = useState('')
  const [credentials, setCredentials] = useState<OAuthCredentials | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function startOAuth() {
    setStep('authorizing')
    setCredentials(null)
    setError(null)
    setCode('')
    const url = await oauth.getAuthUrl()
    setAuthUrl(url)
    window.open(url, '_blank')
  }

  async function submitCode() {
    const trimmed = code.trim()
    if (!trimmed) return
    setStep('exchanging')
    try {
      const creds = await oauth.exchangeCode(trimmed)
      setCredentials(creds)
      setStep('success')
      toast('Token obtenu', true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setStep('error')
      toast('Échec', false)
    }
  }

  function reset() {
    setStep('idle')
    setCode('')
    setCredentials(null)
    setError(null)
    setAuthUrl('')
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">OAuth Test</h1>
        <p className="text-gray-500 dark:text-gray-400 mt-1">
          Flux OAuth Anthropic avec code manuel.
        </p>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-6 space-y-5">

        {/* Step 1 */}
        {step === 'idle' && (
          <button
            onClick={startOAuth}
            className="flex items-center gap-2 px-4 py-2.5 bg-brand-500 hover:bg-brand-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            <ExternalLink className="w-4 h-4" />
            Autoriser
          </button>
        )}

        {/* Step 2 — waiting for code */}
        {step === 'authorizing' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Autorisez l'accès dans la fenêtre qui vient de s'ouvrir, puis copiez le code affiché et collez-le ici.
            </p>
            <a
              href={authUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-brand-500 hover:underline"
            >
              <ExternalLink className="w-3 h-3" />
              Rouvrir la fenêtre d'autorisation
            </a>
            <div className="flex gap-2">
              <input
                type="text"
                value={code}
                onChange={e => setCode(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && submitCode()}
                placeholder="code#state"
                autoFocus
                className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-400"
              />
              <button
                onClick={submitCode}
                disabled={!code.trim()}
                className="flex items-center gap-2 px-4 py-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors"
              >
                <Key className="w-4 h-4" />
                Valider
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — exchanging */}
        {step === 'exchanging' && (
          <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Échange du code en cours…</span>
          </div>
        )}

        {/* Success */}
        {step === 'success' && credentials && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
              <CheckCircle className="w-4 h-4 shrink-0" />
              <span className="text-sm font-medium">Token obtenu</span>
            </div>
            <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3 border border-gray-100 dark:border-gray-700">
              <pre className="text-xs font-mono break-all whitespace-pre-wrap text-gray-700 dark:text-gray-300">
                {JSON.stringify(credentials, null, 2)}
              </pre>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { navigator.clipboard.writeText(JSON.stringify(credentials)); toast('Copié !', true) }}
                className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300 transition-colors"
              >
                Copier le JSON
              </button>
              <button
                onClick={reset}
                className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300 transition-colors"
              >
                Recommencer
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {step === 'error' && error && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-red-600 dark:text-red-400">
              <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <p className="text-sm">{error}</p>
            </div>
            <button
              onClick={reset}
              className="px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300 transition-colors"
            >
              Réessayer
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
