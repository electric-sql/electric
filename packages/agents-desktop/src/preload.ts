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
  | `open-find`
  | `find-next`
  | `find-previous`
  | `split-right`
  | `split-down`
  | `cycle-tile`

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
