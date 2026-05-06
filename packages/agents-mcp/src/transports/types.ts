import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

export interface McpTransportHandle {
  connect(): Promise<void>
  close(): Promise<void>
  /**
   * The underlying MCP client. Populated after `connect()` resolves; null before.
   * Callers use this to invoke MCP methods directly (e.g. `client.callTool(...)`,
   * `client.listTools(...)`) so they get the SDK's typed, schema-validated responses.
   */
  readonly client: Client | null
}
