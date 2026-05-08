export const MCP_TOOLS_SENTINEL = Symbol.for(
  `@electric-ax/agents-mcp/tools-sentinel`
)

export interface McpToolsSentinel {
  [MCP_TOOLS_SENTINEL]: true
  /** `undefined` means every registered server. */
  allowlist?: string[]
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
   * Returns a sentinel array for `tools: [...mcp.tools()]`.
   * Resolution happens at wake time via the runtime's tool-provider
   * hook. Pass an array to restrict to specific servers; omit for
   * every registered server.
   */
  tools(allowlist?: string[]): McpToolsSentinel[] {
    return [{ [MCP_TOOLS_SENTINEL]: true, allowlist }]
  },
}

export function filterByAllowlist(
  serverNames: string[],
  allowlist: string[] | undefined
): string[] {
  if (allowlist === undefined) return [...serverNames]
  const set = new Set(allowlist)
  return serverNames.filter((n) => set.has(n))
}
