import { useEffect } from 'react'

export default function OAuthCallback() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code') ?? undefined
    const state = params.get('state') ?? undefined
    const error = params.get('error') ?? undefined

    const channel = new BroadcastChannel('oauth_callback')
    channel.postMessage({ type: 'oauth_callback', code, state, error })
    channel.close()

    window.close()
  }, [])

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
      <p className="text-gray-500 dark:text-gray-400 text-sm">Authentification en cours, fermeture...</p>
    </div>
  )
}
