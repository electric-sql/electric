import type { AgentTool } from '@mariozechner/pi-agent-core'

// ── Config ──────────────────────────────────────────────────

export interface McpServerConfig {
  /** Stdio transport */
  command?: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string

  /** Streamable HTTP transport */
  url?: string

  /** Auth: OAuth flow, static token, or env var reference */
  auth?: `oauth` | { token: string } | { tokenEnvVar: string }
  /** Arbitrary static headers (values support ${VAR} expansion) */
  headers?: Record<string, string>

  /** OAuth specifics (only when auth is 'oauth') */
  oauth?: {
    clientId?: string
    scopes?: string[]
    callbackPort?: number
  }

  /** Toggle without removing config (default: true) */
  enabled?: boolean
  /** Connection timeout in ms (default: 10_000) */
  startupTimeoutMs?: number
  /** Per-tool-call timeout in ms (default: 60_000) */
  toolTimeoutMs?: number
  /** Idle time before disconnect in ms (default: 300_000) */
  idleTimeoutMs?: number
  /** Max chars in tool output before truncation (default: 25_000) */
  maxOutputChars?: number
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>
}

export type McpOverrides = Record<string, false | McpServerConfig>

// ── Defaults ────────────────────────────────────────────────

export const MCP_DEFAULTS = {
  startupTimeoutMs: 10_000,
  toolTimeoutMs: 60_000,
  idleTimeoutMs: 300_000,
  maxOutputChars: 25_000,
} as const

// ── Pool ────────────────────────────────────────────────────

export type McpServerStatus = `idle` | `connecting` | `connected` | `failed`

export interface McpServerState {
  name: string
  config: McpServerConfig
  status: McpServerStatus
  tools: Array<McpDiscoveredTool>
  resources: Array<McpDiscoveredResource>
  instructions?: string
  error?: string
  sessionId?: string
  protocolVersion?: string
}

export interface McpDiscoveredTool {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

export interface McpDiscoveredResource {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

// ── Integration ─────────────────────────────────────────────

export interface McpIntegration {
  /** Tools for managing MCP config (for Horton) */
  configTools: Array<AgentTool>
  /** Get all bridged MCP tools, applying overrides */
  getTools: (overrides?: McpOverrides) => Promise<Array<AgentTool>>
  /** Get server instructions for system prompt injection */
  getServerInstructions: () => Record<string, string>
  /** Get server summaries for system prompt */
  getServerSummary: () => Promise<string>
  /** Shut down all connections */
  close: () => Promise<void>
}
