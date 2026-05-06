import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpStdioConfig } from '../types'
import type { McpTransportHandle } from './types'

type ClientRequestArgs = Parameters<Client[`request`]>

/**
 * Wraps the official MCP SDK `StdioClientTransport` + `Client` into a
 * minimal {@link McpTransportHandle}. The `send` method delegates to
 * `Client.request`; callers must pass an already-shaped request payload
 * (and result schema) compatible with the SDK's `request` signature.
 *
 * Note: `Client.request` requires a Zod-style result schema as its second
 * argument. Because the wrapper's `send` accepts an opaque `unknown`
 * message, we forward through casts. Real call sites that need typed
 * responses should call `Client.request` directly.
 */
export function createStdioTransport(cfg: McpStdioConfig): McpTransportHandle {
  let client: Client | undefined
  let transport: StdioClientTransport | undefined
  return {
    async connect() {
      transport = new StdioClientTransport({
        command: cfg.command,
        args: cfg.args ?? [],
        env: cfg.env,
      })
      client = new Client(
        { name: `agents-mcp`, version: `0.1.0` },
        { capabilities: {} }
      )
      await client.connect(transport)
    },
    async send(message) {
      if (!client) throw new Error(`not connected`)
      const args = [message, undefined] as unknown as ClientRequestArgs
      return client.request(...args)
    },
    async close() {
      await client?.close()
      client = undefined
      transport = undefined
    },
  }
}
