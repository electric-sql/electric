import { normalizeServer } from './servers'
import { loadDesktopSettings } from './store'
import { seedDefaultMcpServers } from './mcp-defaults'
import { INITIAL_SERVER_URL, PULL_WAKE_RUNNER_ID } from '../shared/constants'
import type {
  ApiKeys,
  DesktopSettings,
  DesktopState,
  RuntimeEntry,
  ServerConfig,
} from '../shared/types'
import type { SecretStore } from '../services/secret-store'

type SettingsBootstrapDeps = {
  settings: DesktopSettings
  apiKeys: ApiKeys
  state: DesktopState
  getSecretStore: () => SecretStore
  ensureRuntimeEntry: (server: ServerConfig) => RuntimeEntry
  desktopStateForWindow: (win: null) => DesktopState
  applyApiKeys: () => void
  syncCodexEnvironment: () => Promise<void>
  saveSettings: () => Promise<void>
}

function initialServerFromEnv(): ServerConfig | null {
  if (!INITIAL_SERVER_URL) return null
  try {
    const url = new URL(INITIAL_SERVER_URL)
    if (url.protocol !== `http:` && url.protocol !== `https:`) {
      console.warn(
        `[agents-desktop] Ignoring ELECTRIC_DESKTOP_SERVER_URL with unsupported protocol: ${INITIAL_SERVER_URL}`
      )
      return null
    }
    url.hash = ``
    url.search = ``
    return normalizeServer(
      {
        name: `Environment server`,
        url: url.toString().replace(/\/$/, ``),
        source: `manual`,
      },
      { defaultDesiredState: `connected` }
    )
  } catch {
    console.warn(
      `[agents-desktop] Ignoring invalid ELECTRIC_DESKTOP_SERVER_URL: ${INITIAL_SERVER_URL}`
    )
    return null
  }
}

async function applyInitialServerFromEnv(
  deps: SettingsBootstrapDeps
): Promise<void> {
  const server = initialServerFromEnv()
  if (!server) return

  const existing = deps.settings.servers.find(
    (entry) => entry.url === server.url
  )
  const next = existing ?? server
  if (!existing) {
    deps.settings.servers = [...deps.settings.servers, next]
    deps.ensureRuntimeEntry(next)
  }
  if (!deps.settings.defaultServerId) {
    deps.settings.defaultServerId = next.id
  }
  Object.assign(deps.state, deps.desktopStateForWindow(null))
  await deps.saveSettings()
}

export async function loadSettings(deps: SettingsBootstrapDeps): Promise<void> {
  const shouldSave = await loadDesktopSettings({
    settings: deps.settings,
    apiKeys: deps.apiKeys,
    getSecretStore: deps.getSecretStore,
    ensureRuntimeEntry: deps.ensureRuntimeEntry,
    pullWakeRunnerId: PULL_WAKE_RUNNER_ID,
  })
  // Seed built-in MCP servers (opt-out): mutates settings + flips the
  // per-name seeded flag. Runs after the disk load so removals from a
  // previous launch (stored in `seededDefaultMcpServerNames`) are
  // honored, and before any runtime starts so the first connection
  // sees these in its `extraMcpServers`.
  const mcpSeeded = seedDefaultMcpServers(deps.settings)
  Object.assign(deps.state, deps.desktopStateForWindow(null))
  await applyInitialServerFromEnv(deps)
  deps.applyApiKeys()
  await deps.syncCodexEnvironment()
  if (shouldSave || mcpSeeded) {
    await deps.saveSettings()
  }
}
