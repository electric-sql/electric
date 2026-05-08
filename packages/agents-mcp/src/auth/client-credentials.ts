import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'

export interface ClientCredentialsOpts {
  tokenUrl: string
  clientId: string
  clientSecret: string
  scopes?: string[]
  audience?: string
  resource?: string
}

/**
 * Minimal OAuthClientProvider implementing only what's needed for clientCredentials:
 * lazy fetches a token on `tokens()`. The SDK's transport uses `tokens()` to attach
 * Authorization headers and re-calls on 401.
 */
export function createClientCredentialsProvider(
  opts: ClientCredentialsOpts
): OAuthClientProvider {
  let cached: { access_token: string; expiresAt: number } | undefined
  return {
    get redirectUrl() {
      return ``
    },
    get clientMetadata() {
      return {} as any
    },
    async clientInformation() {
      return {
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
      } as any
    },
    async saveClientInformation() {},
    async tokens() {
      const now = Math.floor(Date.now() / 1000)
      if (cached && cached.expiresAt - 30 > now) {
        return {
          access_token: cached.access_token,
          token_type: `Bearer`,
        } as any
      }
      const body = new URLSearchParams({
        grant_type: `client_credentials`,
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
      })
      if (opts.scopes?.length) body.set(`scope`, opts.scopes.join(` `))
      if (opts.audience) body.set(`audience`, opts.audience)
      if (opts.resource) body.set(`resource`, opts.resource)
      const res = await fetch(opts.tokenUrl, {
        method: `POST`,
        headers: { 'Content-Type': `application/x-www-form-urlencoded` },
        body,
      })
      if (!res.ok)
        throw new Error(`clientCredentials token endpoint ${res.status}`)
      const json = (await res.json()) as {
        access_token: string
        expires_in?: number
      }
      cached = {
        access_token: json.access_token,
        expiresAt: now + (json.expires_in ?? 300),
      }
      return { access_token: json.access_token, token_type: `Bearer` } as any
    },
    async saveTokens() {},
    redirectToAuthorization() {
      /* unused for client_credentials */
    },
    saveCodeVerifier() {},
    async codeVerifier() {
      return ``
    },
  }
}
