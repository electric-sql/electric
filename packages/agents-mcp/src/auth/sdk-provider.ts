import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens as SdkOAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { AuthStore } from '../credentials/auth-store'
import type { OAuthClientInfo, OAuthTokens } from '../types'

export interface CreateSdkOAuthProviderOpts {
  server: string
  publicUrl: string
  authStore: AuthStore
  scopes?: string[]
  redirectUri?: string
  /** RFC 8707 resource indicator. */
  resource?: string
}

/**
 * Adapter that implements the MCP SDK's `OAuthClientProvider` and reads/writes
 * the registry's internal `AuthStore`. The SDK handles PKCE, DCR (RFC 7591),
 * discovery (RFC 9728), token exchange, refresh, and 401-retry; this adapter
 * just plumbs reads and writes. Cross-process persistence (if any) happens
 * via the `onTokensChanged` / `onClientRegistered` hooks the registry wires
 * into the store from the per-server auth config.
 */
export interface SdkOAuthProvider extends OAuthClientProvider {
  /** Always implemented — persists the DCR response via the internal AuthStore. */
  saveClientInformation(
    clientInformation: OAuthClientInformationMixed
  ): void | Promise<void>
  /** Returns the most recent authorize URL captured by redirectToAuthorization. */
  peekAuthUrl(): string | undefined
  /** Resets the captured authorize URL. */
  clearAuthUrl(): void
}

export function createSdkOAuthProvider(
  opts: CreateSdkOAuthProviderOpts
): SdkOAuthProvider {
  const redirect =
    opts.redirectUri ??
    `${opts.publicUrl.replace(/\/$/, ``)}/oauth/callback/${opts.server}`
  let codeVerifier: string | undefined
  let lastAuthUrl: string | undefined

  const toSdkTokens = (t: OAuthTokens): SdkOAuthTokens =>
    ({
      access_token: t.accessToken,
      refresh_token: t.refreshToken,
      expires_in: t.expiresAt
        ? Math.max(0, t.expiresAt - Math.floor(Date.now() / 1000))
        : undefined,
      token_type: t.tokenType ?? `Bearer`,
      scope: t.scope,
    }) as SdkOAuthTokens

  const fromSdkTokens = (t: SdkOAuthTokens): OAuthTokens => ({
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: t.expires_in
      ? Math.floor(Date.now() / 1000) + t.expires_in
      : undefined,
    tokenType: t.token_type,
    scope: t.scope,
  })

  const toSdkClientInfo = (c: OAuthClientInfo): OAuthClientInformationFull =>
    ({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      redirect_uris: c.redirectUris ?? [redirect],
    }) as OAuthClientInformationFull

  const fromSdkClientInfo = (
    c: OAuthClientInformationMixed
  ): OAuthClientInfo => ({
    clientId: c.client_id,
    clientSecret: (c as OAuthClientInformationFull).client_secret,
    redirectUris: (c as OAuthClientInformationFull).redirect_uris?.map(String),
    registeredAt: Math.floor(Date.now() / 1000),
  })

  return {
    get redirectUrl() {
      return redirect
    },
    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: `@electric-ax/agents-mcp`,
        redirect_uris: [redirect],
        grant_types: [`authorization_code`, `refresh_token`],
        response_types: [`code`],
        token_endpoint_auth_method: `client_secret_post`,
        scope: opts.scopes?.join(` `),
      } as OAuthClientMetadata
    },

    async clientInformation(): Promise<OAuthClientInformation | undefined> {
      const saved = opts.authStore.getOAuthClientInfo(opts.server)
      return saved ? toSdkClientInfo(saved) : undefined
    },

    async saveClientInformation(info: OAuthClientInformationMixed) {
      await opts.authStore.saveOAuthClientInfo(
        opts.server,
        fromSdkClientInfo(info)
      )
    },

    async tokens(): Promise<SdkOAuthTokens | undefined> {
      const saved = opts.authStore.getOAuthTokens(opts.server)
      return saved ? toSdkTokens(saved) : undefined
    },

    async saveTokens(tokens: SdkOAuthTokens) {
      await opts.authStore.saveOAuthTokens(opts.server, fromSdkTokens(tokens))
    },

    redirectToAuthorization(url: URL) {
      lastAuthUrl = url.toString()
    },

    saveCodeVerifier(v: string) {
      codeVerifier = v
    },
    async codeVerifier() {
      if (!codeVerifier)
        throw new Error(`No PKCE codeVerifier set for "${opts.server}"`)
      return codeVerifier
    },

    peekAuthUrl() {
      return lastAuthUrl
    },
    clearAuthUrl() {
      lastAuthUrl = undefined
    },
  }
}
