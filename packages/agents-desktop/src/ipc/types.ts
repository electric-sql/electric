import type { BrowserWindow } from 'electron'
import type {
  ApiKeys,
  CodexAuthSource,
  ConnectServerOptions,
  DesktopAppearance,
  DesktopContextMenuRequest,
  DesktopMenuPopupBounds,
  DesktopMenuSection,
  DesktopMenuState,
  DesktopNavigationState,
  DesktopState,
  OnboardingState,
  RuntimeEntry,
  ServerConfig,
} from '../shared/types'

export type DesktopIpcDeps = {
  settings: {
    servers: Array<ServerConfig>
    defaultServerId: string | null
    workingDirectory?: string | null
  }
  state: DesktopState
  runtimeEntries: Map<string, RuntimeEntry>
  findServer: (serverId: string | null | undefined) => ServerConfig | null
  ensureRuntimeEntry: (server: ServerConfig) => RuntimeEntry
  saveSettings: () => Promise<void>
  refreshDesktopState: () => void
  setState: (patch: Partial<DesktopState>) => void
  desktopStateForWindow: (win: BrowserWindow | null) => DesktopState
  desktopServerFetch: (request: unknown) => Promise<unknown>
  setActiveServer: (
    win: BrowserWindow | null,
    server: ServerConfig | null
  ) => Promise<void>
  setSelectedServerForWindow: (
    win: BrowserWindow | null,
    serverId: string | null
  ) => Promise<void>
  selectedServerIdForWindow: (win: BrowserWindow | null) => string | null
  stopRuntimeEntry: (entry: RuntimeEntry) => Promise<void>
  restartRuntime: (serverId?: string | null) => Promise<void>
  connectServer: (
    serverId: string,
    options?: ConnectServerOptions
  ) => Promise<void>
  disconnectServer: (serverId: string) => Promise<void>
  forgetServer: (serverId: string) => Promise<void>
  stopRuntime: (serverId?: string | null) => Promise<void>
  runDiscovery: () => Promise<void>
  getApiKeysStatus: () => Promise<unknown>
  setApiKeys: (keys: ApiKeys) => Promise<void>
  signInCodex: () => Promise<unknown>
  enableCodexSource: (source: CodexAuthSource) => Promise<unknown>
  disableCodex: () => Promise<unknown>
  restartConnectedRuntimes: () => Promise<void>
  clearAllLocalDataAndRelaunch: () => Promise<void>
  getOnboardingState: () => OnboardingState
  setOnboardingDismissed: (dismissed: boolean) => Promise<void>
  chooseWorkingDirectory: () => Promise<string | null | undefined>
  pickDirectory: (options?: { defaultPath?: string }) => Promise<string | null>
  applyNativeAppearance: (appearance: DesktopAppearance) => void
  showSelectionContextMenu: (
    win: BrowserWindow,
    request: DesktopContextMenuRequest
  ) => void
  popupApplicationMenuSection: (
    win: BrowserWindow,
    section: DesktopMenuSection,
    bounds: DesktopMenuPopupBounds,
    state: DesktopMenuState
  ) => void
  popupAppIconMenu: (win: BrowserWindow, bounds: DesktopMenuPopupBounds) => void
  getNavigationState: (win: BrowserWindow) => DesktopNavigationState
  navigateHistory: (win: BrowserWindow, direction: `back` | `forward`) => void
  getMcpSnapshot: (serverId: string | null | undefined) => unknown
  authorizeMcpServer: (
    serverId: string | null | undefined,
    name: string
  ) => Promise<void>
  reconnectMcpServer: (
    serverId: string | null | undefined,
    name: string
  ) => Promise<void>
  disableMcpServer: (
    serverId: string | null | undefined,
    name: string
  ) => Promise<void>
  enableMcpServer: (
    serverId: string | null | undefined,
    name: string
  ) => Promise<void>
}
