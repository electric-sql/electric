import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { McpTransport } from './types'

export interface HttpTransportOpts {
  name: string
  url: string
  /** Returns a header to add on every request (e.g. apiKey or OAuth bearer). */
  headerProvider?: () => Promise<{ name: string; value: string } | undefined>
  /** Test-only override. */
  fetchImpl?: typeof fetch
}

export function createHttpTransport(opts: HttpTransportOpts): McpTransport {
  const fetchImpl = opts.fetchImpl ?? fetch
  const transport = new StreamableHTTPClientTransport(new URL(opts.url), {
    fetch: async (url, init) => {
      const headers = new Headers(init?.headers)
      const h = await opts.headerProvider?.()
      if (h) headers.set(h.name, h.value)
      return fetchImpl(url, { ...init, headers })
    },
  })
  const client = new Client(
    { name: `@electric-ax/agents-mcp`, version: `0.1.0-experimental.0` },
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
