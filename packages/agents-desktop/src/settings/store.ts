import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SecretStore } from '../services/secret-store'
import type { McpServerConfig } from '../shared/types'
import type {
  ApiKeys,
  CodexSettings,
  DesktopSettings,
  ServerConfig,
} from '../shared/types'
import { settingsPath } from '../shared/paths'
import {
  GLOBAL_API_KEYS_REF,
  loadApiKeysFromSecret,
  normalizeApiKeys,
  saveApiKeysToSecret,
} from '../credentials/api-keys'
import { normalizeEnabledModelValues } from '../credentials/model-picker'
import { normalizeServer, normalizeServers } from './servers'

export { settingsPath } from '../shared/paths'

export const SETTINGS_VERSION = 2

export const DEFAULT_SETTINGS: DesktopSettings = {
  servers: [],
  defaultServerId: null,
  workingDirectory: null,
  apiKeysRef: GLOBAL_API_KEYS_REF,
  launchAtLogin: false,
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

export type LoadDesktopSettingsDeps = {
  settings: DesktopSettings
  apiKeys: ApiKeys
  getSecretStore: () => SecretStore
  ensureRuntimeEntry: (server: ServerConfig) => unknown
  pullWakeRunnerId: string | null
}

export async function loadDesktopSettings(
  deps: LoadDesktopSettingsDeps
): Promise<boolean> {
  let shouldSave = false
  try {
    const raw = await readFile(settingsPath(), `utf8`)
    const parsed = JSON.parse(raw) as Partial<DesktopSettings> & {
      activeServer?: unknown
      apiKeys?: unknown
      version?: unknown
    }
    const legacyActiveServer = normalizeServer(parsed.activeServer)
    const servers = normalizeServers(parsed.servers, legacyActiveServer?.url)
    const parsedPullWakeRunnerId =
      typeof parsed.pullWakeRunnerId === `string`
        ? parsed.pullWakeRunnerId.trim()
        : null
    const pullWakeRunnerId = parsedPullWakeRunnerId || randomUUID()
    if (!parsedPullWakeRunnerId) {
      shouldSave = true
    }
    const defaultServerId =
      typeof parsed.defaultServerId === `string` &&
      servers.some((server) => server.id === parsed.defaultServerId)
        ? parsed.defaultServerId
        : (servers.find((server) => server.url === legacyActiveServer?.url)
            ?.id ??
          servers.find((server) => server.desiredState === `connected`)?.id ??
          servers[0]?.id ??
          null)
    const apiKeysRef =
      typeof parsed.apiKeysRef === `string` && parsed.apiKeysRef.trim()
        ? parsed.apiKeysRef.trim()
        : GLOBAL_API_KEYS_REF
    const enabledModelValues = normalizeEnabledModelValues(
      parsed.enabledModelValues
    )
    Object.assign(deps.settings, {
      servers,
      defaultServerId,
      workingDirectory:
        typeof parsed.workingDirectory === `string`
          ? parsed.workingDirectory
          : null,
      apiKeysRef,
      launchAtLogin: parsed.launchAtLogin === true,
      onboardingDismissed: parsed.onboardingDismissed === true,
      codex: normalizeCodexSettings(parsed.codex),
      enabledModelValues:
        enabledModelValues.length > 0 ? enabledModelValues : undefined,
      mcp: normalizeMcp(parsed.mcp),
      pullWakeRunnerId,
    })
    if (parsed.apiKeys !== undefined) {
      Object.assign(deps.apiKeys, normalizeApiKeys(parsed.apiKeys))
      await saveApiKeysToSecret(deps.getSecretStore(), apiKeysRef, deps.apiKeys)
      shouldSave = true
    } else {
      Object.assign(
        deps.apiKeys,
        await loadApiKeysFromSecret(deps.getSecretStore(), apiKeysRef)
      )
    }
    shouldSave =
      shouldSave ||
      parsed.version !== SETTINGS_VERSION ||
      parsed.activeServer !== undefined ||
      parsed.apiKeys !== undefined ||
      servers.some((server) => !(`id` in (server as object)))
  } catch (err) {
    console.error(`[agents-desktop] Failed to load settings:`, err)
    Object.assign(deps.settings, {
      ...DEFAULT_SETTINGS,
      pullWakeRunnerId: randomUUID(),
    })
    Object.assign(
      deps.apiKeys,
      await loadApiKeysFromSecret(
        deps.getSecretStore(),
        deps.settings.apiKeysRef
      )
    )
    shouldSave = true
  }

  if (
    deps.pullWakeRunnerId &&
    deps.settings.pullWakeRunnerId !== deps.pullWakeRunnerId
  ) {
    deps.settings.pullWakeRunnerId = deps.pullWakeRunnerId
    shouldSave = true
  }

  for (const server of deps.settings.servers) {
    deps.ensureRuntimeEntry(server)
  }

  return shouldSave
}

export async function saveDesktopSettings(
  settings: DesktopSettings
): Promise<void> {
  await mkdir(path.dirname(settingsPath()), { recursive: true })
  await writeFile(
    settingsPath(),
    JSON.stringify(serializeSettings(settings), null, 2)
  )
}
