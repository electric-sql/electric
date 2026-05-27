import type { BrowserWindow, Tray } from 'electron'
import type { CloudAgentServers } from '../cloud-agent-servers'
import type { CloudAuth } from '../cloud-auth'
import type { SecretStore } from '../secret-store'
import type { RegistrySnapshot, RuntimeEntry } from '../shared/types'

export type DesktopAppContext = {
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
