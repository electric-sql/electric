// Process-global registry of tool providers. Wake-time tool composition appends
// each registered provider's tools to whatever the entity type declared.

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

/** @internal — used in unit tests. */
export function __resetToolProvidersForTest(): void {
  providers.clear()
}
