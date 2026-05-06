import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpStdioConfig } from '../types'
import type { McpTransportHandle } from './types'

/**
 * Wraps the official MCP SDK `StdioClientTransport` + `Client` into a
 * minimal {@link McpTransportHandle}. After `connect()` resolves, callers
 * use the exposed `client` directly to invoke MCP methods (e.g.
 * `client.callTool(...)`, `client.listTools(...)`) so they benefit from
 * the SDK's typed, schema-validated responses.
 */
export function createStdioTransport(cfg: McpStdioConfig): McpTransportHandle {
  let _client: Client | undefined
  let _transport: StdioClientTransport | undefined
  return {
    get client(): Client | null {
      return _client ?? null
    },
    async connect() {
      _transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args ?? [],
        env: cfg.env,
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
