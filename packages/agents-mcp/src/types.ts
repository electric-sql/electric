export type McpAuthMode = `apiKey` | `clientCredentials` | `authorizationCode`

export type McpServerStatus =
  | `healthy`
  | `expiring`
  | `needs_auth`
  | `error`
  | `disabled`

export type McpTransport = `stdio` | `http`

export interface McpServerConfigBase {
  transport: McpTransport
}

export interface McpStdioConfig extends McpServerConfigBase {
  transport: `stdio`
  command: string
  args?: string[]
  env?: Record<string, string>
}

export interface McpHttpConfig extends McpServerConfigBase {
  transport: `http`
  url: string
  auth: McpAuthConfig
}

export type McpServerConfig = McpStdioConfig | McpHttpConfig

export type McpAuthConfig =
  | { mode: `apiKey`; headerName: string; valueRef: string }
  | {
      mode: `clientCredentials`
      clientIdRef: string
      clientSecretRef: string
      tokenUrl: string
      scopes?: string[]
    }
  | {
      mode: `authorizationCode`
      flow: `browser` | `device`
      scopes?: string[]
      clientIdRef?: string
      authorizationUrl?: string
      tokenUrl?: string
    }

export type McpToolError =
  | { kind: `auth_unavailable`; server: string; detail?: string }
  | { kind: `transport_error`; server: string; detail: string }
  | { kind: `timeout`; server: string; ms: number }
  | {
      kind: `server_error`
      server: string
      code?: string | number
      message: string
    }
  | { kind: `tool_not_found`; server: string; tool: string }
  | { kind: `schema_violation`; server: string; tool: string; detail: string }
