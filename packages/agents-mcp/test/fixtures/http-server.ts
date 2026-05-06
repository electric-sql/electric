/**
 * Minimal Streamable-HTTP-compatible server that bridges the in-process
 * `createMockServer` fixture to HTTP. Used by the HTTP E2E tests
 * (`test/e2e/http.e2e.test.ts`) so the MCP SDK's `StreamableHTTPClientTransport`
 * can talk to the same scenarios that the stdio fixture exposes.
 *
 * This implements just enough of the Streamable HTTP spec for the SDK client:
 *   - POST <url> with a JSON-RPC body returns either a single JSON response
 *     (when no progressToken is present) or an SSE stream (when one is, so
 *     `notifications/progress` can be relayed before the final result).
 *   - JSON-RPC notifications (no `id`) return 202 Accepted with no body —
 *     this matches what the client expects for `notifications/initialized`,
 *     and avoids triggering the SDK client's GET SSE connection.
 *   - GET <url> returns 405 to signal "no standalone SSE stream", which the
 *     spec explicitly allows and the client handles gracefully.
 *   - DELETE returns 405 (no session termination support).
 *
 * Notes (intentional simplifications):
 *   - Stateless (no `Mcp-Session-Id` header). The SDK client only stores a
 *     session id if the server returns one; absence is supported.
 *   - No request batching (a single JSON object per POST).
 *   - The mock's `onNotification` callback is wired per-request when SSE is
 *     in play; tests that exercise concurrent progress requests would need
 *     a per-request mock instance, but the current scenarios are sequential.
 */
import { createServer, type Server } from 'node:http'
import {
  createMockServer,
  type Scenario,
  type JsonRpcRequest,
  type JsonRpcNotification,
} from './mock-mcp-server'

export interface MockHttpServer {
  url: string
  close(): Promise<void>
}

export async function startMockHttpServer(
  scenario: Scenario = `default`
): Promise<MockHttpServer> {
  const mock = createMockServer({ scenario })

  const server: Server = createServer(async (req, res) => {
    // The MCP SDK client probes GET <url> for a standalone SSE stream after
    // initialization. 405 tells it "not supported" — the spec explicitly
    // permits this and the client handles it gracefully.
    if (req.method === `GET`) {
      res.writeHead(405)
      res.end()
      return
    }
    if (req.method === `DELETE`) {
      res.writeHead(405)
      res.end()
      return
    }
    if (req.method !== `POST`) {
      res.writeHead(405)
      res.end()
      return
    }

    const chunks: Array<Buffer> = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    const body = Buffer.concat(chunks).toString(`utf8`)
    let parsed: JsonRpcRequest | JsonRpcNotification
    try {
      parsed = JSON.parse(body)
    } catch {
      res.writeHead(400, { 'Content-Type': `application/json` })
      res.end(
        JSON.stringify({
          jsonrpc: `2.0`,
          id: null,
          error: { code: -32700, message: `Parse error` },
        })
      )
      return
    }

    // Notifications (no `id`) get 202 Accepted with no body. This is what
    // the SDK client expects after sending `notifications/initialized`.
    const isNotification = typeof (parsed as JsonRpcRequest).id === `undefined`
    if (isNotification) {
      res.writeHead(202)
      res.end()
      return
    }

    const request = parsed as JsonRpcRequest
    const params = request.params as
      | { _meta?: { progressToken?: string | number } }
      | undefined
    const wantsProgress =
      params?._meta?.progressToken !== undefined &&
      params._meta.progressToken !== null

    if (wantsProgress) {
      // SSE response: stream notifications then the final result.
      res.writeHead(200, {
        'Content-Type': `text/event-stream`,
        'Cache-Control': `no-cache`,
        Connection: `keep-alive`,
      })
      const handler = (n: JsonRpcNotification): void => {
        res.write(`event: message\ndata: ${JSON.stringify(n)}\n\n`)
      }
      const prev = mock.onNotification
      mock.onNotification = handler
      try {
        const result = await mock.handle(request)
        res.write(`event: message\ndata: ${JSON.stringify(result)}\n\n`)
      } finally {
        mock.onNotification = prev
      }
      res.end()
      return
    }

    // Default: single JSON response.
    const result = await mock.handle(request)
    res.writeHead(200, { 'Content-Type': `application/json` })
    res.end(JSON.stringify(result))
  })

  await new Promise<void>((resolve) => {
    server.listen(0, `127.0.0.1`, resolve)
  })
  const addr = server.address()
  const port = typeof addr === `object` && addr ? addr.port : 0
  const url = `http://127.0.0.1:${port}/mcp`

  return {
    url,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}
