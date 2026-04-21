import { OAUTH_CONFIG } from '../constants/oauth.js'

// ===== PKCE (Web Crypto API) =====
function base64URLEncode(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function generateCodeVerifier(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return base64URLEncode(array.buffer)
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return base64URLEncode(hash)
}

// ===== TYPES =====
type AnthropicTokenResponse = {
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
}

export type OAuthCredentials = {
  claudeAiOauth: {
    accessToken: string
    refreshToken?: string
    expiresAt?: number
    scopes?: string[]
  }
}

// ===== SERVICE =====
export class OAuthService {
  private codeVerifier: string
  private expectedState: string | null = null

  constructor() {
    this.codeVerifier = generateCodeVerifier()
  }

  async getAuthUrl(): Promise<string> {
    const codeChallenge = await generateCodeChallenge(this.codeVerifier)
    const stateBytes = new Uint8Array(32)
    crypto.getRandomValues(stateBytes)
    const state = base64URLEncode(stateBytes.buffer)
    this.expectedState = state

    const authUrl = new URL(OAUTH_CONFIG.AUTHORIZE_URL)
    authUrl.searchParams.set('code', 'true')
    authUrl.searchParams.set('client_id', OAUTH_CONFIG.CLIENT_ID)
    authUrl.searchParams.set('response_type', 'code')
    authUrl.searchParams.set('redirect_uri', OAUTH_CONFIG.MANUAL_REDIRECT_URL)
    authUrl.searchParams.set('scope', OAUTH_CONFIG.SCOPES.join(' '))
    authUrl.searchParams.set('code_challenge', codeChallenge)
    authUrl.searchParams.set('code_challenge_method', 'S256')
    authUrl.searchParams.set('state', state)

    return authUrl.toString()
  }

  // Expects the value pasted by the user: "authorizationCode#state"
  async exchangeCode(pastedValue: string): Promise<OAuthCredentials> {
    const [authorizationCode, state] = pastedValue.split('#')

    if (!authorizationCode || !state) {
      throw new Error('Invalid format — paste the full value (code#state)')
    }

    if (state !== this.expectedState) {
      throw new Error('Invalid state — restart the OAuth flow')
    }

    const res = await fetch('/api/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code: authorizationCode,
        redirect_uri: OAUTH_CONFIG.MANUAL_REDIRECT_URL,
        client_id: OAUTH_CONFIG.CLIENT_ID,
        code_verifier: this.codeVerifier,
        state,
      }),
    })

    const text = await res.text()
    if (!res.ok) {
      throw new Error(`Token exchange failed (${res.status}): ${text}`)
    }

    const data = JSON.parse(text) as AnthropicTokenResponse
    return {
      claudeAiOauth: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
        scopes: data.scope?.split(" "),
      },
    }
  }
}
