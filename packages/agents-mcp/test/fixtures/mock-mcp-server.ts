/**
 * Mock MCP server fixture used by the agents-mcp E2E tests.
 *
 * Can be used two ways:
 *  1. As a stdio subprocess: `tsx ./test/fixtures/mock-mcp-server.ts [scenario]`
 *     reads JSON-RPC lines from stdin and writes responses (and notifications)
 *     to stdout, one JSON object per line.
 *  2. As an in-process handler: `createMockServer({ scenario })` returns a
 *     `MockServer` whose `handle(req)` resolves with a JSON-RPC response, and
 *     whose `onNotification` is invoked for server-initiated notifications.
 *
 * Scenarios encode behaviors used by transport / registry tests.
 */

export type Scenario =
  | `default`
  | `error`
  | `slow`
  | `progress`
  | `auth-required`
  | `tools-changed`

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

const TOOLS = {
  default: [
    {
      name: `echo`,
      description: `echo input`,
      inputSchema: {
        type: `object`,
        properties: { msg: { type: `string` } },
        required: [`msg`],
      },
    },
    {
      name: `add`,
      description: `add two numbers`,
      inputSchema: {
        type: `object`,
        properties: { a: { type: `number` }, b: { type: `number` } },
        required: [`a`, `b`],
      },
    },
    {
      name: `long`,
      description: `long-running tool`,
      inputSchema: { type: `object`, properties: {} },
    },
  ],
  changed: [
    {
      name: `echo2`,
      description: `echo v2`,
      inputSchema: { type: `object`, properties: {} },
    },
  ],
}

const RESOURCES = [
  { uri: `mock://config.json`, name: `config`, mimeType: `application/json` },
  { uri: `mock://readme.md`, name: `readme`, mimeType: `text/markdown` },
]

const PROMPTS = [
  {
    name: `greet`,
    description: `greet user`,
    arguments: [{ name: `name`, required: true }],
  },
]

export function createMockServer(
  opts: { scenario?: Scenario } = {}
): MockServer {
  let scenario: Scenario = opts.scenario ?? `default`

  const server: MockServer = {
    setScenario(s) {
      scenario = s
    },
    async handle(req) {
      switch (req.method) {
        case `initialize`:
          return {
            jsonrpc: `2.0`,
            id: req.id,
            result: {
              protocolVersion: `2024-11-05`,
              capabilities: {
                tools: {},
                resources: {},
                prompts: {},
                logging: {},
              },
              serverInfo: { name: `mock`, version: `0` },
            },
          }

        case `tools/list`: {
          const tools =
            scenario === `tools-changed` ? TOOLS.changed : TOOLS.default
          return { jsonrpc: `2.0`, id: req.id, result: { tools } }
        }

        case `tools/call`: {
          if (scenario === `auth-required`) {
            return {
              jsonrpc: `2.0`,
              id: req.id,
              error: { code: -32001, message: `Unauthorized` },
            }
          }
          if (scenario === `error`) {
            return {
              jsonrpc: `2.0`,
              id: req.id,
              error: { code: -32603, message: `tool failed` },
            }
          }
          if (scenario === `slow`) {
            await new Promise((r) => setTimeout(r, 100))
          }
          if (scenario === `progress` && req.params?._meta?.progressToken) {
            const token = req.params._meta.progressToken
            for (let i = 1; i <= 3; i++) {
              await new Promise((r) => setTimeout(r, 5))
              server.onNotification?.({
                jsonrpc: `2.0`,
                method: `notifications/progress`,
                params: { progressToken: token, progress: i, total: 3 },
              })
            }
          }

          const name = req.params?.name
          if (name === `echo`) {
            return {
              jsonrpc: `2.0`,
              id: req.id,
              result: {
                content: [
                  { type: `text`, text: String(req.params.arguments.msg) },
                ],
              },
            }
          }
          if (name === `add`) {
            return {
              jsonrpc: `2.0`,
              id: req.id,
              result: {
                content: [
                  {
                    type: `text`,
                    text: String(
                      req.params.arguments.a + req.params.arguments.b
                    ),
                  },
                ],
              },
            }
          }
          if (name === `long`) {
            return {
              jsonrpc: `2.0`,
              id: req.id,
              result: { content: [{ type: `text`, text: `done` }] },
            }
          }
          return {
            jsonrpc: `2.0`,
            id: req.id,
            error: { code: -32602, message: `unknown tool: ${name}` },
          }
        }

        case `resources/list`:
          return {
            jsonrpc: `2.0`,
            id: req.id,
            result: { resources: RESOURCES },
          }

        case `resources/read`: {
          const uri = req.params?.uri
          if (uri === `mock://config.json`) {
            return {
              jsonrpc: `2.0`,
              id: req.id,
              result: {
                contents: [
                  {
                    uri,
                    mimeType: `application/json`,
                    text: `{"hello":1}`,
                  },
                ],
              },
            }
          }
          if (uri === `mock://readme.md`) {
            return {
              jsonrpc: `2.0`,
              id: req.id,
              result: {
                contents: [{ uri, mimeType: `text/markdown`, text: `# mock` }],
              },
            }
          }
          return {
            jsonrpc: `2.0`,
            id: req.id,
            error: { code: -32602, message: `unknown resource` },
          }
        }

        case `prompts/list`:
          return {
            jsonrpc: `2.0`,
            id: req.id,
            result: { prompts: PROMPTS },
          }

        case `prompts/get`:
          return {
            jsonrpc: `2.0`,
            id: req.id,
            result: {
              messages: [
                {
                  role: `user`,
                  content: {
                    type: `text`,
                    text: `Hello, ${req.params.arguments.name}!`,
                  },
                },
              ],
            },
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
  const scenario = (process.argv[2] as Scenario) ?? `default`
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
