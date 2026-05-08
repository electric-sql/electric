// Process-global registry of tool providers. Wake-time tool composition appends
// each registered provider's tools to whatever the entity type declared.

import { runtimeLog } from './log'

// NOTE: These two helpers are intentionally inlined here (duplicated from
// @electric-ax/agents-mcp/tools) so that agents-runtime does NOT import the
// full agents-mcp package at the top level.  The agents-server-ui Vite build
// bundles agents-runtime for the browser; pulling in agents-mcp would
// transitively drag in @modelcontextprotocol/sdk stdio (node:stream etc.) and
// break the browser bundle.  The sentinel uses Symbol.for so it stays
// structurally identical to the version in agents-mcp — any value created by
// mcp.tools() over there will still pass isMcpToolsSentinel() here.

const MCP_TOOLS_SENTINEL_KEY = Symbol.for(
  `@electric-ax/agents-mcp/tools-sentinel`
)

interface McpToolsSentinelLike {
  [key: symbol]: true
  allowlist?: string[]
}

function isMcpToolsSentinel(x: unknown): x is McpToolsSentinelLike {
  return (
    !!x &&
    typeof x === `object` &&
    (x as Record<symbol, unknown>)[MCP_TOOLS_SENTINEL_KEY] === true
  )
}

function filterByAllowlist(
  serverNames: string[],
  allowlist: string[] | undefined
): string[] {
  if (allowlist === undefined) return [...serverNames]
  const set = new Set(allowlist)
  return serverNames.filter((n) => set.has(n))
}

export interface ToolProviderEntry {
  name: string
  tools: () => unknown[] | Promise<unknown[]>
}

const providers = new Map<string, ToolProviderEntry>()

export function registerToolProvider(p: ToolProviderEntry): void {
  providers.set(p.name, p)
}

export function unregisterToolProvider(name: string): void {
  providers.delete(name)
}

export async function resolveToolProviders(): Promise<unknown[]> {
  const out: unknown[] = []
  for (const p of providers.values()) {
    const t = await p.tools()
    out.push(...t)
  }
  return out
}

/**
 * Expands any MCP sentinel objects in `declaredTools` into the actual provider
 * tools they match, leaving non-sentinel entries unchanged.
 */
export async function composeToolsWithProviders(
  declaredTools: ReadonlyArray<unknown>
): Promise<unknown[]> {
  const providerTools = await resolveToolProviders()
  const allServers = [
    ...new Set(
      providerTools
        .map((p) => (p as { server?: string }).server)
        .filter((s): s is string => typeof s === `string`)
    ),
  ]
  // Named MCP servers that resolve to nothing — typo'd, not
  // configured, or registered-but-not-ready — would otherwise
  // expand silently to an empty set and the agent would run
  // under-equipped. Wildcard sentinels (no allowlist) are not
  // reported.
  const missing = new Set<string>()
  for (const t of declaredTools) {
    if (isMcpToolsSentinel(t) && t.allowlist) {
      for (const name of t.allowlist) {
        if (!allServers.includes(name)) missing.add(name)
      }
    }
  }
  if (missing.size > 0) {
    runtimeLog.warn(
      `[mcp]`,
      `requested MCP server(s) unavailable: ${[...missing]
        .map((n) => `"${n}"`)
        .join(`, `)}. ` +
        `These may be misconfigured or still connecting/authenticating; ` +
        `their tools will be missing from this agent's toolset.`
    )
  }
  return declaredTools.flatMap((t) => {
    if (isMcpToolsSentinel(t)) {
      const matching = filterByAllowlist(allServers, t.allowlist)
      return providerTools.filter((p) =>
        matching.includes((p as { server: string }).server)
      )
    }
    return [t]
  })
}

/** @internal — used in unit tests. */
export function __resetToolProvidersForTest(): void {
  providers.clear()
}
