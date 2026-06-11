/** Persisted-token shape — surfaces in OAuth callbacks (`onTokensChanged`). */
export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  /** Unix seconds. */
  expiresAt?: number
  tokenType?: string
  scope?: string
}

/** DCR-registered (or pre-registered) OAuth client — surfaces in `onClientRegistered`. */
export interface OAuthClientInfo {
  clientId: string
  clientSecret?: string
  redirectUris?: string[]
  /** Unix seconds. */
  registeredAt?: number
}

export type McpAuthMode =
  | `none`
  | `apiKey`
  | `clientCredentials`
  | `authorizationCode`

export type McpAuthConfig =
  | { mode: `none` }
  | {
      mode: `apiKey`
      /** Raw secret. Inline at the call site (e.g. `process.env.X_API_KEY`). */
      key: string
      headerName?: string /* default: Authorization */
      valuePrefix?: string /* e.g. 'Bearer ' */
    }
  | {
      mode: `clientCredentials`
      tokenUrl: string
      /** Inline at the call site (e.g. `process.env.X_CLIENT_ID`). */
      clientId: string
      /** Inline at the call site (e.g. `process.env.X_CLIENT_SECRET`). */
      clientSecret: string
      scopes?: string[]
      audience?: string
      resource?: string
    }
  | {
      mode: `authorizationCode`
      scopes?: string[]
      resource?: string
      /** Override redirect URI; default `${publicUrl}/oauth/callback/<server>`. */
      redirectUri?: string
      /**
       * Pre-registered OAuth client. When present, RFC 7591 Dynamic Client
       * Registration is skipped. Sourced from the operator's secret system.
       */
      client?: OAuthClientInfo
      /**
       * Pre-existing tokens to seed the registry's in-process cache on
       * boot. When present, the OAuth flow is skipped and the SDK uses
       * these directly. Refresh-token rotation still happens transparently.
       */
      tokens?: OAuthTokens
      /**
       * Fires after initial-auth and on every refresh-token rotation.
       * Wire to a persistence layer (keychain, file, vault, ...) if you
       * want tokens to survive process restarts. Optional — without it,
       * tokens live only for the lifetime of the registry.
       */
      onTokensChanged?: (tokens: OAuthTokens) => void | Promise<void>
      /**
       * Fires once after Dynamic Client Registration completes. Pair
       * with `client` on the next boot to skip DCR.
       */
      onClientRegistered?: (client: OAuthClientInfo) => void | Promise<void>
      /**
       * Reference into a per-process map of pre-built OAuthClientProvider
       * instances. Escape hatch for embedders with non-standard requirements
       * (mTLS, OIDC quirks, etc.).
       */
      oauthProviderRef?: string
    }

export interface McpHttpServerConfig {
  name: string
  transport: `http`
  url: string
  auth: McpAuthConfig
  /** Per-server timeout override in ms. Default 120000, maximum 600000. */
  timeoutMs?: number
}

export interface McpStdioServerConfig {
  name: string
  transport: `stdio`
  command: string
  args?: string[]
  env?: Record<string, string>
  auth?: McpAuthConfig /* typically 'none' for stdio */
  /** Per-server timeout override in ms. Default 120000, maximum 600000. */
  timeoutMs?: number
}

export type McpServerConfig = McpHttpServerConfig | McpStdioServerConfig

export type McpServerStatus =
  | `connecting`
  | `authenticating`
  | `ready`
  | `error`
  | `disabled`

export type McpToolErrorKind =
  | `auth_unavailable`
  | `transport_error`
  | `timeout`
  | `server_error`
  | `tool_not_found`

export interface McpToolError {
  kind: McpToolErrorKind
  message: string
  details?: unknown
}

export type AddServerResult =
  | { state: `ready`; id: string; toolCount: number }
  | { state: `authenticating`; id: string; authUrl: string }
  | { state: `error`; id: string; error: McpToolError }
