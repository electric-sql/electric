import { contextBridge, ipcRenderer } from 'electron'

// The Vite desktop build already stamps `<html data-electric-desktop="true">`
// into the index, so CSS that targets desktop broadly matches from the first
// paint. The preload adds the runtime platform for macOS-only titlebar chrome.
// Wrapped in try/catch so a DOM hiccup can never block
// `contextBridge.exposeInMainWorld` further down — losing
// `window.electronAPI` would break the whole UI.
try {
  if (typeof document !== `undefined` && document.documentElement) {
    document.documentElement.dataset.electricDesktop = `true`
    document.documentElement.dataset.electricPlatform = process.platform
  } else if (typeof window !== `undefined`) {
    window.addEventListener(`DOMContentLoaded`, () => {
      document.documentElement.dataset.electricDesktop = `true`
      document.documentElement.dataset.electricPlatform = process.platform
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

type DesktopAppearance = `light` | `dark`

type DesktopContextMenuRequest = {
  kind: `selection`
  selectionText: string
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
    getSnapshot: (): Promise<{ seq: number; servers: Array<unknown> }> =>
      ipcRenderer.invoke(`desktop:mcp-snapshot`),
    onState: (
      callback: (snapshot: { seq: number; servers: Array<unknown> }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        snapshot: { seq: number; servers: Array<unknown> }
      ) => callback(snapshot)
      ipcRenderer.on(`desktop:mcp-state`, listener)
      return () => ipcRenderer.removeListener(`desktop:mcp-state`, listener)
    },
    authorize: (name: string): Promise<void> =>
      ipcRenderer.invoke(`desktop:mcp-authorize`, name),
    reconnect: (name: string): Promise<void> =>
      ipcRenderer.invoke(`desktop:mcp-reconnect`, name),
    disable: (name: string): Promise<void> =>
      ipcRenderer.invoke(`desktop:mcp-disable`, name),
    enable: (name: string): Promise<void> =>
      ipcRenderer.invoke(`desktop:mcp-enable`, name),
  },
}

contextBridge.exposeInMainWorld(`electronAPI`, api)
