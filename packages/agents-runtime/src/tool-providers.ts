// Process-global registry of tool providers. Wake-time tool composition appends
// each registered provider's tools to whatever the entity type declared.

import { isMcpToolsSentinel, filterByAllowlist } from '@electric-ax/agents-mcp'

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
