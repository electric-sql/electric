import type { Client } from '@modelcontextprotocol/sdk/client/index.js'

export interface McpTransport {
  client: Client
  connect(): Promise<void>
  close(): Promise<void>
}
