import { contextBridge, ipcRenderer } from 'electron'

// The Vite desktop build already stamps `<html data-electric-desktop="true">`
// into the index, so CSS that targets `html[data-electric-desktop='true']`
// matches from the first paint. We re-apply it here as a safety net in
// case anything (HMR, navigation, etc.) drops the attribute. Wrapped in
// try/catch so a DOM hiccup can never block `contextBridge.exposeInMainWorld`
// further down — losing `window.electronAPI` would break the whole UI.
try {
  if (typeof document !== `undefined` && document.documentElement) {
    document.documentElement.dataset.electricDesktop = `true`
  } else if (typeof window !== `undefined`) {
    window.addEventListener(`DOMContentLoaded`, () => {
      document.documentElement.dataset.electricDesktop = `true`
    })
  }
} catch {
  // Non-fatal — the static attribute in index.html is the source of truth.
}

type ServerConfig = {
  name: string
  url: string
}

type DesktopRuntimeStatus = `stopped` | `starting` | `running` | `error`

type DiscoveredServer = {
  url: string
  port: number
  lastSeen: number
}

type DesktopState = {
  runtimeStatus: DesktopRuntimeStatus
  runtimeUrl: string | null
  activeServer: ServerConfig | null
  workingDirectory: string | null
  error: string | null
  discoveredServers: Array<DiscoveredServer>
}

type ApiKeys = {
  anthropic: string | null
  openai: string | null
  brave: string | null
}

type ApiKeysStatus = {
  hasAnyKey: boolean
  saved: ApiKeys
  suggested: ApiKeys
}

// Mirror of `DesktopCommand` in main.ts. Kept as a string union here so
// the preload bundle has zero runtime cost; main is the source of
// truth for which commands actually fire.
type DesktopCommand =
  | `new-chat`
  | `close-tile`
  | `toggle-sidebar`
  | `open-search`
  | `split-right`
  | `split-down`
  | `cycle-tile`

const api = {
  getServers: (): Promise<Array<ServerConfig>> =>
    ipcRenderer.invoke(`desktop:get-servers`),
  saveServers: (servers: Array<ServerConfig>): Promise<void> =>
    ipcRenderer.invoke(`desktop:save-servers`, servers),
  getDesktopState: (): Promise<DesktopState> =>
    ipcRenderer.invoke(`desktop:get-state`),
  setActiveServer: (server: ServerConfig | null): Promise<void> =>
    ipcRenderer.invoke(`desktop:set-active-server`, server),
  restartRuntime: (): Promise<void> =>
    ipcRenderer.invoke(`desktop:restart-runtime`),
  stopRuntime: (): Promise<void> => ipcRenderer.invoke(`desktop:stop-runtime`),
  rescanServers: (): Promise<Array<DiscoveredServer>> =>
    ipcRenderer.invoke(`desktop:rescan-servers`),
  getApiKeysStatus: (): Promise<ApiKeysStatus> =>
    ipcRenderer.invoke(`desktop:get-api-keys-status`),
  saveApiKeys: (keys: ApiKeys): Promise<void> =>
    ipcRenderer.invoke(`desktop:save-api-keys`, keys),
  getWorkingDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(`desktop:get-working-directory`),
  chooseWorkingDirectory: (): Promise<string | null> =>
    ipcRenderer.invoke(`desktop:choose-working-directory`),
  onDesktopStateChanged: (
    callback: (state: DesktopState) => void
  ): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: DesktopState) =>
      callback(state)
    ipcRenderer.on(`desktop:state-changed`, listener)
    return () => ipcRenderer.removeListener(`desktop:state-changed`, listener)
  },
  onDesktopCommand: (
    callback: (command: DesktopCommand) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      command: DesktopCommand
    ) => callback(command)
    ipcRenderer.on(`desktop:command`, listener)
    return () => ipcRenderer.removeListener(`desktop:command`, listener)
  },
}

contextBridge.exposeInMainWorld(`electronAPI`, api)
