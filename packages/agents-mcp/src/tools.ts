import type { Registry } from './registry'
import { bridgeMcpTool, type BridgedTool } from './bridge/tool-bridge'

const DEFAULT_TIMEOUT_MS = 30_000

export interface McpToolsHandle {
  tools(): BridgedTool[]
}

export function createMcpTools(
  registry: Registry,
  allowlist: string[] | `*`,
  opts: { timeoutMs?: number } = {}
): McpToolsHandle {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return {
    tools() {
      const all = registry.list()
      const selected =
        allowlist === `*` ? all : all.filter((s) => allowlist.includes(s.name))
      return selected.flatMap((s) =>
        (s.tools ?? []).map((t) =>
          bridgeMcpTool({
            server: s.name,
            tool: t,
            invoke: (server, toolName, args, tm) =>
              registry.invokeMethod(
                server,
                `tools/call`,
                {
                  name: toolName,
                  arguments: args as Record<string, unknown>,
                },
                tm
              ),
            timeoutMs,
          })
        )
      )
    },
  }
}
