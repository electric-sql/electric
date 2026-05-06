import { TimeoutError } from '../transports/timeout'
import type { McpToolError } from '../types'

export interface BridgeOpts {
  server: string
  tool: { name: string; description?: string; inputSchema?: unknown }
  invoke: (
    server: string,
    toolName: string,
    args: unknown,
    timeoutMs: number
  ) => Promise<unknown>
  timeoutMs: number
}

export interface BridgedTool {
  name: string
  description?: string
  inputSchema?: unknown
  run(args: unknown): Promise<unknown>
}

/**
 * Builds an Anthropic-compatible tool name. Anthropic enforces
 * `^[a-zA-Z0-9_-]{1,128}$` on tool names, so we cannot use `.` as a
 * separator. We use `mcp__<server>__<tool>` (Claude Code convention),
 * sanitizing the server name to the allowed alphabet.
 */
export function mcpToolName(server: string, tool: string): string {
  const safeServer = server.replace(/[^a-zA-Z0-9_-]/g, `_`)
  const safeTool = tool.replace(/[^a-zA-Z0-9_-]/g, `_`)
  return `mcp__${safeServer}__${safeTool}`
}

export function bridgeMcpTool(opts: BridgeOpts): BridgedTool {
  const fullName = mcpToolName(opts.server, opts.tool.name)
  return {
    name: fullName,
    description: opts.tool.description,
    inputSchema: opts.tool.inputSchema,
    async run(args) {
      try {
        return await opts.invoke(
          opts.server,
          opts.tool.name,
          args,
          opts.timeoutMs
        )
      } catch (err) {
        return { error: toToolError(err, opts.server) }
      }
    },
  }
}

function toToolError(err: unknown, server: string): McpToolError {
  if (err instanceof TimeoutError)
    return { kind: `timeout`, server, ms: err.ms }
  const msg = err instanceof Error ? err.message : String(err)
  if (/auth/i.test(msg))
    return { kind: `auth_unavailable`, server, detail: msg }
  return { kind: `transport_error`, server, detail: msg }
}
