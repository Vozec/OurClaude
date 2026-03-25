import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { authApi } from '../lib/api'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const navigate = useNavigate()
  const qc = useQueryClient()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await authApi.login({
        username,
        password,
        ...(needsTotp && totpCode ? { totp_code: totpCode } : {}),
      })
      await qc.invalidateQueries({ queryKey: ['me'] })
      navigate('/')
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Login failed'
      if (msg === 'totp_required') {
        setNeedsTotp(true)
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 to-gray-800">
      <div className="w-full max-w-md">
        {/* Logo / Title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand-500 mb-4">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Claude Proxy</h1>
          <p className="text-gray-400 mt-1">Admin Dashboard</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            {!needsTotp ? (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                    placeholder="admin"
                    required
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </>
            ) : (
              <div>
                <div className="mb-4 p-3 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-700 font-medium">Two-factor authentication required</p>
                  <p className="text-sm text-blue-600 mt-0.5">Enter the 6-digit code from your authenticator app.</p>
                </div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Authenticator Code
                </label>
                <input
                  type="text"
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  className="w-full px-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent text-center text-2xl tracking-widest dark:bg-gray-700 dark:text-white dark:placeholder-gray-400"
                  placeholder="000000"
                  maxLength={6}
                  autoFocus
                />
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white font-medium rounded-lg transition-colors"
            >
              {loading ? 'Signing in...' : needsTotp ? 'Verify' : 'Sign in'}
            </button>

            {needsTotp && (
              <button
                type="button"
                onClick={() => { setNeedsTotp(false); setTotpCode('') }}
                className="w-full py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                ← Back to login
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  )
}
