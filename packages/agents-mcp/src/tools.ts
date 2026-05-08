export const MCP_TOOLS_SENTINEL = Symbol.for(
  `@electric-ax/agents-mcp/tools-sentinel`
)

export interface McpToolsSentinel {
  [MCP_TOOLS_SENTINEL]: true
  allowlist: string[] | `*`
}

export function isMcpToolsSentinel(x: unknown): x is McpToolsSentinel {
  return (
    !!x &&
    typeof x === `object` &&
    (x as Record<symbol, unknown>)[MCP_TOOLS_SENTINEL] === true
  )
}

export const mcp = {
  /**
   * Returns a sentinel array suitable for `tools: [...mcp.tools(['sentry'])]`
   * in an entity-type definition. Resolution happens at wake time via the
   * runtime's tool-provider hook.
   *
   * - `mcp.tools()` — every registered server (default).
   * - `mcp.tools(['sentry', 'github'])` — only the named servers.
   * - `mcp.tools('*')` — explicit form of the default; kept for
   *   back-compat with earlier callers.
   */
  tools(allowlist?: string[] | `*`): McpToolsSentinel[] {
    return [{ [MCP_TOOLS_SENTINEL]: true, allowlist: allowlist ?? `*` }]
  },
}

export function filterByAllowlist(
  serverNames: string[],
  allowlist: string[] | `*`
): string[] {
  if (allowlist === `*`) return [...serverNames]
  const set = new Set(allowlist)
  return serverNames.filter((n) => set.has(n))
}
