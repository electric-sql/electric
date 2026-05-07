import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js'
import type { McpTransport } from './types'

export interface HttpTransportOpts {
  name: string
  url: string
  /** Returns a header to add on every request (e.g. apiKey). */
  headerProvider?: () => Promise<{ name: string; value: string } | undefined>
  /** SDK auth provider — when set, the SDK transport handles 401-retry, refresh, DCR, etc. */
  authProvider?: OAuthClientProvider
  /** Test-only override. */
  fetchImpl?: typeof fetch
}

export function createHttpTransport(opts: HttpTransportOpts): McpTransport {
  const fetchImpl = opts.fetchImpl ?? fetch
  const transport = new StreamableHTTPClientTransport(new URL(opts.url), {
    authProvider: opts.authProvider,
    fetch: opts.headerProvider
      ? async (url, init) => {
          const headers = new Headers(init?.headers)
          const h = await opts.headerProvider!()
          if (h) headers.set(h.name, h.value)
          return fetchImpl(url, { ...init, headers })
        }
      : fetchImpl,
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
