import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import type { McpTransport } from './types'

export interface StdioTransportOpts {
  name: string
  command: string
  args?: string[]
  env?: Record<string, string>
}

export function createStdioTransport(opts: StdioTransportOpts): McpTransport {
  const transport = new StdioClientTransport({
    command: opts.command,
    args: opts.args ?? [],
    env: opts.env,
  })
  const client = new Client(
    { name: `@electric-ax/agents-mcp`, version: `0.1.0` },
    { capabilities: {} }
  )
  return {
    client,
    async connect() {
      await client.connect(transport)
    },
    async close() {
      await client.close()
    },
  }
}
