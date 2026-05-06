import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens as SdkOAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  CredentialStore,
  OAuthClientInfo,
  OAuthTokens,
} from '../credentials/types'

export interface CreateSdkOAuthProviderOpts {
  server: string
  publicUrl: string
  credentials: CredentialStore
  scopes?: string[]
  redirectUri?: string
  /** RFC 8707 resource indicator. */
  resource?: string
}

/**
 * Adapter that implements MCP SDK's OAuthClientProvider, persisting via CredentialStore.
 * The SDK handles PKCE, DCR (RFC 7591), discovery (RFC 9728), token exchange, refresh,
 * and 401-retry. We only persist.
 */
export interface SdkOAuthProvider extends OAuthClientProvider {
  /** Always implemented — persists DCR response via CredentialStore. */
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
      const saved = await opts.credentials.getOAuthClientInfo?.(opts.server)
      return saved ? toSdkClientInfo(saved) : undefined
    },

    async saveClientInformation(info: OAuthClientInformationMixed) {
      if (!opts.credentials.saveOAuthClientInfo) {
        throw new Error(
          `No CredentialStore.saveOAuthClientInfo available — cannot persist DCR result for "${opts.server}"`
        )
      }
      await opts.credentials.saveOAuthClientInfo(
        opts.server,
        fromSdkClientInfo(info)
      )
    },

    async tokens(): Promise<SdkOAuthTokens | undefined> {
      const saved = await opts.credentials.getOAuthTokens?.(opts.server)
      return saved ? toSdkTokens(saved) : undefined
    },

    async saveTokens(tokens: SdkOAuthTokens) {
      if (!opts.credentials.saveOAuthTokens) {
        throw new Error(
          `No CredentialStore.saveOAuthTokens available — cannot persist tokens for "${opts.server}"`
        )
      }
      await opts.credentials.saveOAuthTokens(opts.server, fromSdkTokens(tokens))
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
