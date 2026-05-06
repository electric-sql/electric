import { withTimeout, DEFAULT_TIMEOUT_MS } from '../transports/timeout'
import type { McpToolError } from '../types'

const PREFIX = `mcp`
const MAX_LEN = 128

function sanitize(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, `_`)
}

export function prefixToolName(server: string, tool: string): string {
  const full = `${PREFIX}__${sanitize(server)}__${sanitize(tool)}`
  return full.length > MAX_LEN ? full.slice(0, MAX_LEN) : full
}

export interface BridgeToolOpts {
  server: string
  tool: { name: string; description?: string; inputSchema: unknown }
  /** Subset of MCP SDK Client we use here. */
  client: {
    callTool: (
      args: { name: string; arguments?: unknown },
      opts?: { onProgress?: (p: unknown) => void; signal?: AbortSignal }
    ) => Promise<unknown>
  }
  timeoutMs?: number
  /** Optional progress notification callback forwarded to the SDK. */
  onProgress?: (p: unknown) => void
  /** Optional AbortSignal forwarded to the SDK callTool. */
  signal?: AbortSignal
}

export interface BridgedTool {
  name: string
  server: string
  description?: string
  inputSchema: unknown
  call(args: unknown): Promise<unknown>
}

export function bridgeMcpTool(opts: BridgeToolOpts): BridgedTool {
  const name = prefixToolName(opts.server, opts.tool.name)
  const ms = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return {
    name,
    server: opts.server,
    description: opts.tool.description,
    inputSchema: opts.tool.inputSchema,
    async call(args) {
      try {
        const callArgs: Parameters<typeof opts.client.callTool> =
          opts.onProgress !== undefined || opts.signal !== undefined
            ? [
                { name: opts.tool.name, arguments: args },
                { onProgress: opts.onProgress, signal: opts.signal },
              ]
            : [{ name: opts.tool.name, arguments: args }]
        return await withTimeout(opts.client.callTool(...callArgs), ms)
      } catch (err) {
        const e = err as Partial<McpToolError> & { message?: string }
        if (e.kind === `timeout`) throw err
        const wrapped: McpToolError = {
          kind: `transport_error`,
          message: e.message ?? String(err),
        }
        throw wrapped
      }
    },
  }
}
