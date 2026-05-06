export type McpAuthMode =
  | `none`
  | `apiKey`
  | `clientCredentials`
  | `authorizationCode`

export type McpAuthConfig =
  | { mode: `none` }
  | {
      mode: `apiKey`
      headerName?: string /* default: Authorization */
      valuePrefix?: string /* e.g. 'Bearer ' */
    }
  | {
      mode: `clientCredentials`
      tokenUrl: string
      scopes?: string[]
      audience?: string
      resource?: string
    }
  | {
      mode: `authorizationCode`
      flow: `browser` | `device`
      scopes?: string[]
      resource?: string
      /** Override redirect URI; default `${publicUrl}/oauth/callback/<server>`. */
      redirectUri?: string
      /** Reference into a per-process map of pre-built OAuthClientProvider instances. */
      oauthProviderRef?: string
    }

export interface McpHttpServerConfig {
  name: string
  transport: `http`
  url: string
  auth: McpAuthConfig
  /** Per-server timeout override in ms. Default 30000. */
  timeoutMs?: number
}

export interface McpStdioServerConfig {
  name: string
  transport: `stdio`
  command: string
  args?: string[]
  env?: Record<string, string>
  auth?: McpAuthConfig /* typically 'none' for stdio */
  /** Per-server timeout override in ms. Default 30000. */
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
  | {
      state: `authenticating`
      id: string
      authUrl: string
      deviceCode?: {
        userCode: string
        expiresAt: number
        verificationUriComplete?: string
      }
    }
  | { state: `error`; id: string; error: McpToolError }
