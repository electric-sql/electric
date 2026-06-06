import type { BrowserWindow, Tray } from 'electron'
import {
  CloudAgentServers,
  type CloudAgentServersState,
} from '../cloud/cloud-agent-servers'
import { CloudAuth, type CloudAuthState } from '../cloud/cloud-auth'
import { createCliController, type CliController } from '../cli/controller'
import { SecretStore } from '../services/secret-store'
import { captureEnvApiKeys, EMPTY_API_KEYS } from '../credentials/api-keys'
import { DEFAULT_SETTINGS } from '../settings/store'
import type {
  ApiKeys,
  DesktopMcpSnapshot,
  DesktopSettings,
  DesktopState,
  RuntimeEntry,
} from '../shared/types'

export type DesktopAppContextOptions = {
  secretsPath: () => string
  onCloudAuthState: (state: CloudAuthState) => void
  onCloudAgentServersState: (state: CloudAgentServersState) => void
}

export type DesktopAppContext = {
  settings: DesktopSettings
  apiKeys: ApiKeys
  envApiKeysSnapshot: ApiKeys
  state: DesktopState
  credentialsRestartPending: boolean
  windows: Set<BrowserWindow>
  windowSelections: Map<number, string | null>
  runtimeEntries: Map<string, RuntimeEntry>
  lastMcpSnapshots: Map<string, DesktopMcpSnapshot>
  shell: {
    tray: Tray | null
    aboutWindow: BrowserWindow | null
    isQuitting: boolean
  }
  services: {
    secretStore: SecretStore | null
    cloudAuth: CloudAuth | null
    cloudAgentServers: CloudAgentServers | null
    cli: CliController | null
  }
  getSecretStore: () => SecretStore
  getCloudAuth: () => CloudAuth
  getCloudAgentServers: () => CloudAgentServers
  getCli: () => CliController
}

export function createDesktopAppContext(
  options: DesktopAppContextOptions
): DesktopAppContext {
  const ctx: DesktopAppContext = {
    settings: { ...DEFAULT_SETTINGS },
    apiKeys: { ...EMPTY_API_KEYS },
    envApiKeysSnapshot: captureEnvApiKeys(process.env),
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
      cli: null,
    },
    getSecretStore() {
      if (!ctx.services.secretStore) {
        ctx.services.secretStore = new SecretStore(options.secretsPath())
      }
      return ctx.services.secretStore
    },
    getCloudAuth() {
      if (!ctx.services.cloudAuth) {
        ctx.services.cloudAuth = new CloudAuth(ctx.getSecretStore())
        ctx.services.cloudAuth.subscribe((next) => {
          options.onCloudAuthState(next)
          if (next.status === `signed-in`) {
            void ctx.getCloudAgentServers().start()
          } else {
            void ctx.getCloudAgentServers().stop()
          }
        })
      }
      return ctx.services.cloudAuth
    },
    getCloudAgentServers() {
      if (!ctx.services.cloudAgentServers) {
        ctx.services.cloudAgentServers = new CloudAgentServers(
          ctx.getCloudAuth(),
          ctx.getSecretStore()
        )
        ctx.services.cloudAgentServers.subscribe(
          options.onCloudAgentServersState
        )
      }
      return ctx.services.cloudAgentServers
    },
    getCli() {
      ctx.services.cli ??= createCliController()
      return ctx.services.cli
    },
  }
  return ctx
}
