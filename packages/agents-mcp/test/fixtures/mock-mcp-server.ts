/**
 * Trimmed mock MCP server fixture for the agents-mcp E2E edge-case suite.
 *
 * Happy-path protocol coverage now lives in `test/e2e/everything.e2e.test.ts`
 * (against `@modelcontextprotocol/server-everything`). This fixture exists
 * only for scenarios the reference server cannot easily simulate:
 *
 *   - `auth-required`: returns a JSON-RPC `Unauthorized` error on
 *     `tools/call`. Used to verify the bridge's `auth_unavailable` mapping.
 *   - `tools-changed`: returns a different tool list on each `tools/list`
 *     call. Used to verify that re-applying config (or a fresh connect)
 *     picks up changed tool inventories.
 *
 * Can be used two ways:
 *   1. As a stdio subprocess: `tsx ./test/fixtures/mock-mcp-server.ts <scenario>`
 *      reads JSON-RPC lines from stdin and writes responses to stdout, one
 *      JSON object per line.
 *   2. As an in-process handler: `createMockServer({ scenario })` returns a
 *      `MockServer` whose `handle(req)` resolves with a JSON-RPC response.
 */

export type Scenario = `auth-required` | `tools-changed`

export interface JsonRpcRequest {
  jsonrpc: `2.0`
  id: number | string
  method: string
  params?: any
}

export interface JsonRpcNotification {
  jsonrpc: `2.0`
  method: string
  params?: any
}

export interface MockServer {
  handle(req: JsonRpcRequest): Promise<any>
  onNotification?: (n: JsonRpcNotification) => void
  setScenario(s: Scenario): void
}

const TOOLS_INITIAL = [
  {
    name: `echo`,
    description: `echo input`,
    inputSchema: {
      type: `object`,
      properties: { msg: { type: `string` } },
      required: [`msg`],
    },
  },
]

const TOOLS_AFTER_CHANGE = [
  {
    name: `echo2`,
    description: `echo v2`,
    inputSchema: { type: `object`, properties: {} },
  },
]

export function createMockServer(
  opts: { scenario?: Scenario } = {}
): MockServer {
  let scenario: Scenario = opts.scenario ?? `auth-required`
  // For `tools-changed`: the first `tools/list` returns the initial set, and
  // every subsequent call returns the changed set. This lets a test verify
  // that re-fetching the tool list (e.g. via a fresh connect) picks up the
  // new shape.
  let toolsListCalls = 0

  const server: MockServer = {
    setScenario(s) {
      scenario = s
      toolsListCalls = 0
    },
    async handle(req) {
      switch (req.method) {
        case `initialize`:
          return {
            jsonrpc: `2.0`,
            id: req.id,
            result: {
              protocolVersion: `2024-11-05`,
              capabilities: { tools: {} },
              serverInfo: { name: `mock`, version: `0` },
            },
          }

        case `tools/list`: {
          if (scenario === `tools-changed`) {
            toolsListCalls += 1
            const tools =
              toolsListCalls === 1 ? TOOLS_INITIAL : TOOLS_AFTER_CHANGE
            return { jsonrpc: `2.0`, id: req.id, result: { tools } }
          }
          return {
            jsonrpc: `2.0`,
            id: req.id,
            result: { tools: TOOLS_INITIAL },
          }
        }

        case `tools/call`: {
          if (scenario === `auth-required`) {
            return {
              jsonrpc: `2.0`,
              id: req.id,
              error: { code: -32001, message: `Unauthorized` },
            }
          }
          // tools-changed: simple echo so callers can verify the new tool
          // shape. Not the focus of this fixture, but keeps tools/call
          // functional in that scenario.
          const name = req.params?.name
          if (name === `echo` || name === `echo2`) {
            return {
              jsonrpc: `2.0`,
              id: req.id,
              result: {
                content: [
                  {
                    type: `text`,
                    text: String(req.params?.arguments?.msg ?? ``),
                  },
                ],
              },
            }
          }
          return {
            jsonrpc: `2.0`,
            id: req.id,
            error: { code: -32602, message: `unknown tool: ${name}` },
          }
        }

        default:
          return {
            jsonrpc: `2.0`,
            id: req.id,
            error: {
              code: -32601,
              message: `method not found: ${req.method}`,
            },
          }
      }
    },
  }

  return server
}

// Stdio mode entry point — when invoked as a subprocess via `tsx`/`node`.
// Detects "is this the main module" using import.meta.url vs argv[1].
if (
  typeof process !== `undefined` &&
  process.argv[1] &&
  import.meta.url === `file://${process.argv[1]}`
) {
  const scenario = (process.argv[2] as Scenario) ?? `auth-required`
  const srv = createMockServer({ scenario })
  srv.onNotification = (n) => process.stdout.write(JSON.stringify(n) + `\n`)
  let buf = ``
  process.stdin.setEncoding(`utf8`)
  process.stdin.on(`data`, async (chunk: string) => {
    buf += chunk
    let nl: number
    while ((nl = buf.indexOf(`\n`)) !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (!line.trim()) continue
      try {
        const req = JSON.parse(line) as JsonRpcRequest
        const res = await srv.handle(req)
        process.stdout.write(JSON.stringify(res) + `\n`)
      } catch (err) {
        process.stderr.write(
          `mock-mcp-server parse error: ${(err as Error).message}\n`
        )
      }
    }
  })
}
