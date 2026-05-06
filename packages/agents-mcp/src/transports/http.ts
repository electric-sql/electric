import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpHttpConfig } from '../types'
import type { McpTransportHandle } from './types'

export type GetToken = () => Promise<string | null>

/**
 * Wraps the official MCP SDK `StreamableHTTPClientTransport` + `Client`
 * into a minimal {@link McpTransportHandle}. After `connect()` resolves,
 * callers use the exposed `client` directly to invoke MCP methods (e.g.
 * `client.callTool(...)`, `client.listTools(...)`) so they benefit from
 * the SDK's typed, schema-validated responses.
 *
 * The `getToken` adapter resolves the bearer token to attach as
 * `Authorization: Bearer <token>` on each request. For `apiKey` modes
 * where the header is not `Authorization: Bearer …`, the registry layer
 * (Task 11/21) selects the right adapter; here we simply slot a Bearer
 * header when a token is available.
 */
export function createHttpTransport(
  cfg: McpHttpConfig,
  getToken: GetToken
): McpTransportHandle {
  let _client: Client | undefined
  let _transport: StreamableHTTPClientTransport | undefined
  return {
    get client(): Client | null {
      return _client ?? null
    },
    async connect() {
      const token = await getToken()
      _transport = new StreamableHTTPClientTransport(new URL(cfg.url), {
        requestInit: token
          ? { headers: { Authorization: `Bearer ${token}` } }
          : {},
      })
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
