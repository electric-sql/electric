import type { BrowserWindow, Tray } from 'electron'
import type { CloudAgentServers } from '../cloud-agent-servers'
import type { CloudAuth } from '../cloud-auth'
import type { SecretStore } from '../secret-store'
import { EMPTY_API_KEYS } from '../credentials/api-keys'
import { DEFAULT_SETTINGS } from '../settings/store'
import type {
  ApiKeys,
  DesktopSettings,
  DesktopState,
  RegistrySnapshot,
  RuntimeEntry,
} from '../shared/types'

export type DesktopAppContext = {
  settings: DesktopSettings
  apiKeys: ApiKeys
  state: DesktopState
  credentialsRestartPending: boolean
  windows: Set<BrowserWindow>
  windowSelections: Map<number, string | null>
  runtimeEntries: Map<string, RuntimeEntry>
  lastMcpSnapshots: Map<string, RegistrySnapshot>
  shell: {
    tray: Tray | null
    aboutWindow: BrowserWindow | null
    isQuitting: boolean
  }
  services: {
    secretStore: SecretStore | null
    cloudAuth: CloudAuth | null
    cloudAgentServers: CloudAgentServers | null
  }
}

export function createDesktopAppContext(): DesktopAppContext {
  return {
    settings: { ...DEFAULT_SETTINGS },
    apiKeys: { ...EMPTY_API_KEYS },
    state: {
      servers: [],
      selectedServerId: null,
      connections: [],
      runtimeStatus: `stopped`,
      runtimeUrl: null,
      activeServer: null,
      workingDirectory: null,
      error: null,
      discoveredServers: [],
      pullWakeRunnerId: null,
      credentialsRestartPending: false,
    },
    credentialsRestartPending: false,
    windows: new Set(),
    windowSelections: new Map(),
    runtimeEntries: new Map(),
    lastMcpSnapshots: new Map(),
    shell: {
      tray: null,
      aboutWindow: null,
      isQuitting: false,
    },
    services: {
      secretStore: null,
      cloudAuth: null,
      cloudAgentServers: null,
    },
  }
}
