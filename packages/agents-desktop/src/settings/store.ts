import type { McpServerConfig } from '../shared/types'
import type { CodexSettings, DesktopSettings } from '../shared/types'

export const SETTINGS_VERSION = 2
export const GLOBAL_API_KEYS_REF = `api-keys:global`

export const DEFAULT_SETTINGS: DesktopSettings = {
  servers: [],
  defaultServerId: null,
  workingDirectory: null,
  apiKeysRef: GLOBAL_API_KEYS_REF,
  codex: { enabled: false, source: null },
}

export function normalizeCodexSettings(value: unknown): CodexSettings {
  if (!value || typeof value !== `object`) {
    return { enabled: false, source: null }
  }
  const maybe = value as Partial<Record<keyof CodexSettings, unknown>>
  const source =
    maybe.source === `desktop-oauth` ||
    maybe.source === `codex-cli` ||
    maybe.source === `opencode`
      ? maybe.source
      : null
  return {
    enabled: maybe.enabled === true && source !== null,
    source,
  }
}

// On disk we mirror `mcp.json`'s keyed-by-name shape. In memory we rewrite into
// the array form `BuiltinAgentsServer.extraMcpServers` expects.
export function normalizeMcp(
  value: unknown
): { servers: Array<McpServerConfig> } | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== `object`) {
    console.warn(
      `[agents-desktop] settings.json: 'mcp' must be an object, got ${typeof value}; ignoring`
    )
    return undefined
  }
  const maybeServers = (value as { servers?: unknown }).servers
  if (maybeServers === undefined) return undefined
  if (
    typeof maybeServers !== `object` ||
    maybeServers === null ||
    Array.isArray(maybeServers)
  ) {
    console.warn(
      `[agents-desktop] settings.json: 'mcp.servers' must be an object keyed by server name; ignoring`
    )
    return undefined
  }
  const servers: McpServerConfig[] = []
  for (const [name, entry] of Object.entries(
    maybeServers as Record<string, unknown>
  )) {
    if (!entry || typeof entry !== `object`) {
      console.warn(
        `[agents-desktop] settings.json: 'mcp.servers.${name}' is not an object; skipping`
      )
      continue
    }
    if (`name` in entry && (entry as { name: unknown }).name !== name) {
      console.warn(
        `[agents-desktop] settings.json: 'mcp.servers.${name}' has a conflicting 'name' field; the keyed name wins`
      )
    }
    servers.push({ ...(entry as object), name } as McpServerConfig)
  }
  return servers.length > 0 ? { servers } : undefined
}

export function serializeSettings(
  settings: DesktopSettings
): Record<string, unknown> {
  const { mcp, ...rest } = settings
  const base = { version: SETTINGS_VERSION, ...rest }
  if (!mcp || mcp.servers.length === 0) return base
  const servers: Record<string, Record<string, unknown>> = {}
  for (const s of mcp.servers) {
    const { name, ...entry } = s as McpServerConfig & Record<string, unknown>
    servers[name] = entry
  }
  return { ...base, mcp: { servers } }
}
