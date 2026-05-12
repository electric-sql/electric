import { contextBridge, ipcRenderer } from 'electron'

// The Vite desktop build already stamps `<html data-electric-desktop="true">`
// into the index, so CSS that targets desktop broadly matches from the first
// paint. The preload adds the runtime platform for macOS-only titlebar chrome.
// Wrapped in try/catch so a DOM hiccup can never block
// `contextBridge.exposeInMainWorld` further down — losing
// `window.electronAPI` would break the whole UI.
try {
  const applyFullscreenState = (fullscreen: boolean): void => {
    document.documentElement.dataset.electricFullscreen = fullscreen
      ? `true`
      : `false`
  }

  if (typeof document !== `undefined` && document.documentElement) {
    document.documentElement.dataset.electricDesktop = `true`
    document.documentElement.dataset.electricPlatform = process.platform
    applyFullscreenState(false)
  } else if (typeof window !== `undefined`) {
    window.addEventListener(`DOMContentLoaded`, () => {
      document.documentElement.dataset.electricDesktop = `true`
      document.documentElement.dataset.electricPlatform = process.platform
      applyFullscreenState(false)
    })
  }

  ipcRenderer.on(
    `desktop:fullscreen-state-changed`,
    (_event, fullscreen: boolean) => {
      applyFullscreenState(fullscreen)
    }
  )
} catch {
  // Non-fatal — the static attribute in index.html is the source of truth.
}

type ServerConfig = {
  id: string
  name: string
  url: string
  source: `manual` | `local-discovery` | `electric-cloud`
  desiredState: `connected` | `disconnected`
  localRuntimeEnabled: boolean
}

type DesktopRuntimeStatus = `stopped` | `starting` | `running` | `error`
type LocalRuntimeStatus =
  | `disabled`
  | `stopped`
  | `starting`
  | `running`
  | `error`
type ServerConnectionStatus =
  | `disconnected`
  | `connecting`
  | `connected`
  | `reconnecting`
  | `offline`
  | `error`

type DiscoveredServer = {
  url: string
  port: number
  lastSeen: number
}

type DesktopState = {
  servers: Array<ServerConfig>
  selectedServerId: string | null
  connections: Array<ServerConnectionState>
  runtimeStatus: DesktopRuntimeStatus
  runtimeUrl: string | null
  activeServer: ServerConfig | null
  workingDirectory: string | null
  error: string | null
  discoveredServers: Array<DiscoveredServer>
}

type ServerConnectionState = {
  serverId: string
  status: ServerConnectionStatus
  localRuntimeStatus: LocalRuntimeStatus
  runtimeUrl: string | null
  runtimeError: string | null
  lastError: string | null
  reconnectAttempt: number
  lastConnectedAt: number | null
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
  | `open-settings`
  | `open-servers-settings`
  | `open-search`
  | `open-find`
  | `find-next`
  | `find-previous`
  | `split-right`
  | `split-down`
  | `cycle-tile`

type DesktopMenuSection = `File` | `Edit` | `View` | `Window` | `Help`

type DesktopMenuPopupBounds = {
  x: number
  y: number
  width: number
  height: number
}

type DesktopMenuState = {
  hasActiveTile: boolean
  canCloseTile: boolean
  canSplitTile: boolean
  canCycleTile: boolean
}

type DesktopNavigationState = {
  canGoBack: boolean
  canGoForward: boolean
}

type DesktopAppearance = `light` | `dark` | `system`

type DesktopContextMenuRequest = {
  kind: `selection`
  selectionText: string
}

// Mirror of `cloud-auth.ts` types — kept inline here so the preload
// bundle stays self-contained (no shared workspace type imports).
type CloudAuthProvider = `github` | `google`
type CloudAuthStatus = `signed-out` | `signing-in` | `signed-in` | `error`
type CloudAuthWorkspace = {
  id: string
  name: string
}
type CloudAuthState = {
  status: CloudAuthStatus
  email: string | null
  name: string | null
  userId: string | null
  workspaces: ReadonlyArray<CloudAuthWorkspace> | null
  error: string | null
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  const editable = target.closest(
    `input, textarea, select, [contenteditable]:not([contenteditable="false"])`
  )
  return editable !== null
}

function selectionIntersectsContext(
  selection: Selection,
  contextRoot: Element
): boolean {
  for (let index = 0; index < selection.rangeCount; index++) {
    const range = selection.getRangeAt(index)
    if (range.collapsed) continue
    if (range.intersectsNode(contextRoot)) return true
  }
  return false
}

function isSelectionContextControl(target: Element): boolean {
  return (
    target.closest(
      `a[href], button, [role="button"], [data-md-code-block-actions], [data-md-table-toolbar]`
    ) !== null
  )
}

function installContextMenuBridge(): void {
  window.addEventListener(
    `contextmenu`,
    (event) => {
      if (isEditableElement(event.target)) return
      if (!(event.target instanceof Element)) return
      if (isSelectionContextControl(event.target)) return

      const contextRoot = event.target.closest(
        `[data-desktop-selection-context]`
      )
      if (!contextRoot) return

      const selection = window.getSelection()
      const selectionText = selection?.toString().trim() ?? ``
      if (!selection || selectionText.length === 0) return
      if (!selectionIntersectsContext(selection, contextRoot)) return

      event.preventDefault()
      ipcRenderer.send(`desktop:show-context-menu`, {
        kind: `selection`,
        selectionText,
      } satisfies DesktopContextMenuRequest)
    },
    { capture: true }
  )
}

if (typeof window !== `undefined`) {
  installContextMenuBridge()
}

const api = {
  getServers: (): Promise<Array<ServerConfig>> =>
    ipcRenderer.invoke(`desktop:get-servers`),
  saveServers: (servers: Array<ServerConfig>): Promise<void> =>
    ipcRenderer.invoke(`desktop:save-servers`, servers),
  getDesktopState: (): Promise<DesktopState> =>
    ipcRenderer.invoke(`desktop:get-state`),
  setNativeAppearance: (appearance: DesktopAppearance): Promise<void> =>
    ipcRenderer.invoke(`desktop:set-native-appearance`, appearance),
  setActiveServer: (server: ServerConfig | null): Promise<void> =>
    ipcRenderer.invoke(`desktop:set-active-server`, server),
  setSelectedServer: (serverId: string | null): Promise<void> =>
    ipcRenderer.invoke(`desktop:set-selected-server`, serverId),
  connectServer: (serverId: string): Promise<void> =>
    ipcRenderer.invoke(`desktop:connect-server`, serverId),
  disconnectServer: (serverId: string): Promise<void> =>
    ipcRenderer.invoke(`desktop:disconnect-server`, serverId),
  restartRuntime: (): Promise<void> =>
    ipcRenderer.invoke(`desktop:restart-runtime`),
  restartServerRuntime: (serverId: string): Promise<void> =>
    ipcRenderer.invoke(`desktop:restart-runtime`, serverId),
  stopRuntime: (): Promise<void> => ipcRenderer.invoke(`desktop:stop-runtime`),
  stopServerRuntime: (serverId: string): Promise<void> =>
    ipcRenderer.invoke(`desktop:stop-runtime`, serverId),
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
  pickDirectory: (options?: { defaultPath?: string }): Promise<string | null> =>
    ipcRenderer.invoke(`desktop:pick-directory`, options),
  showMenuSection: (
    section: DesktopMenuSection,
    bounds: DesktopMenuPopupBounds,
    state: DesktopMenuState
  ): Promise<void> =>
    ipcRenderer.invoke(`desktop:show-menu-section`, section, bounds, state),
  showAppMenu: (bounds: DesktopMenuPopupBounds): Promise<void> =>
    ipcRenderer.invoke(`desktop:show-app-menu`, bounds),
  getNavigationState: (): Promise<DesktopNavigationState> =>
    ipcRenderer.invoke(`desktop:get-navigation-state`),
  navigateHistory: (direction: `back` | `forward`): Promise<void> =>
    ipcRenderer.invoke(`desktop:navigate-history`, direction),
  onNavigationStateChanged: (
    callback: (state: DesktopNavigationState) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: DesktopNavigationState
    ) => callback(state)
    ipcRenderer.on(`desktop:navigation-state-changed`, listener)
    return () =>
      ipcRenderer.removeListener(`desktop:navigation-state-changed`, listener)
  },
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
  // ── MCP registry surface ────────────────────────────────────────
  // Push-based view of the embedded BuiltinAgentsServer's MCP registry.
  // `getSnapshot()` returns the most recent snapshot (or an empty list
  // if the runtime isn't up yet) so the renderer can render before the
  // first push event arrives.
  mcp: {
    getSnapshot: (
      serverId?: string
    ): Promise<{ seq: number; servers: Array<unknown> }> =>
      ipcRenderer.invoke(`desktop:mcp-snapshot`, serverId),
    onState: (
      callback: (
        payload:
          | { seq: number; servers: Array<unknown> }
          | {
              serverId: string
              snapshot: { seq: number; servers: Array<unknown> }
            }
      ) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload:
          | { seq: number; servers: Array<unknown> }
          | {
              serverId: string
              snapshot: { seq: number; servers: Array<unknown> }
            }
      ) => callback(payload)
      ipcRenderer.on(`desktop:mcp-state`, listener)
      return () => ipcRenderer.removeListener(`desktop:mcp-state`, listener)
    },
    authorize: (name: string, serverId?: string): Promise<void> =>
      ipcRenderer.invoke(`desktop:mcp-authorize`, name, serverId),
    reconnect: (name: string, serverId?: string): Promise<void> =>
      ipcRenderer.invoke(`desktop:mcp-reconnect`, name, serverId),
    disable: (name: string, serverId?: string): Promise<void> =>
      ipcRenderer.invoke(`desktop:mcp-disable`, name, serverId),
    enable: (name: string, serverId?: string): Promise<void> =>
      ipcRenderer.invoke(`desktop:mcp-enable`, name, serverId),
  },
  // ── Electric Cloud auth surface ────────────────────────────────
  // Sign-in opens a child BrowserWindow that intercepts the
  // dashboard OAuth callback redirect; the resolved state is pushed
  // through `onStateChanged`.
  cloudAuth: {
    getState: (): Promise<CloudAuthState> =>
      ipcRenderer.invoke(`desktop:cloud-auth-state`),
    signIn: (provider: CloudAuthProvider): Promise<void> =>
      ipcRenderer.invoke(`desktop:cloud-auth-sign-in`, provider),
    signOut: (): Promise<void> =>
      ipcRenderer.invoke(`desktop:cloud-auth-sign-out`),
    openDashboard: (): Promise<void> =>
      ipcRenderer.invoke(`desktop:cloud-auth-open-dashboard`),
    onStateChanged: (
      callback: (state: CloudAuthState) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        state: CloudAuthState
      ) => callback(state)
      ipcRenderer.on(`desktop:cloud-auth-state-changed`, listener)
      return () =>
        ipcRenderer.removeListener(`desktop:cloud-auth-state-changed`, listener)
    },
  },
}

contextBridge.exposeInMainWorld(`electronAPI`, api)
