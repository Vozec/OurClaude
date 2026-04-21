const BASE_CONFIG = {
  REDIRECT_PORT: 54545,
  MANUAL_REDIRECT_URL: 'https://platform.claude.com/oauth/code/callback',
  SCOPES: [
    "org:create_api_key",
    "user:profile",
    "user:inference",
    "user:sessions:claude_code",
    "user:mcp_servers",
    "user:file_upload",
  ] as const,
}

export const OAUTH_CONFIG = {
  ...BASE_CONFIG,
  AUTHORIZE_URL: 'https://claude.ai/oauth/authorize',
  TOKEN_URL: 'https://console.anthropic.com/v1/oauth/token',
  API_KEY_URL: 'https://api.anthropic.com/api/oauth/claude_cli/create_api_key',
  SUCCESS_URL: 'https://console.anthropic.com/buy_credits?returnUrl=/oauth/code/success',
  CLIENT_ID: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
} as const