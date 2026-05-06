import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpHttpConfig } from '../types'
import type { McpTransportHandle } from './types'

export type GetAuthHeader = () => Promise<{
  name: string
  value: string
} | null>

/**
 * Wraps the official MCP SDK `StreamableHTTPClientTransport` + `Client`
 * into a minimal {@link McpTransportHandle}. After `connect()` resolves,
 * callers use the exposed `client` directly to invoke MCP methods (e.g.
 * `client.callTool(...)`, `client.listTools(...)`) so they benefit from
 * the SDK's typed, schema-validated responses.
 *
 * The `getAuthHeader` adapter resolves the auth header (name + value) to
 * attach on each request. The registry layer (Task 11/21) selects the
 * right adapter for each auth mode (e.g. `Authorization: Bearer …` for
 * OAuth modes, or arbitrary header names like `X-Honeycomb-Team` for
 * apiKey modes); here we simply slot whatever header is provided.
 */
export function createHttpTransport(
  cfg: McpHttpConfig,
  getAuthHeader: GetAuthHeader
): McpTransportHandle {
  let _client: Client | undefined
  let _transport: StreamableHTTPClientTransport | undefined
  return {
    get client(): Client | null {
      return _client ?? null
    },
    async connect() {
      const auth = await getAuthHeader()
      const headers = auth ? { [auth.name]: auth.value } : undefined
      _transport = new StreamableHTTPClientTransport(
        new URL(cfg.url),
        headers ? { requestInit: { headers } } : {}
      )
      _client = new Client(
        { name: `agents-mcp`, version: `0.1.0` },
        { capabilities: {} }
      )
      await _client.connect(_transport)
    },
    async close() {
      await _client?.close()
      _client = undefined
      _transport = undefined
    },
  }
}
