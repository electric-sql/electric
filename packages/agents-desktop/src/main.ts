import { BuiltinAgentsServer } from '@electric-ax/agents'
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeImage,
} from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type ServerConfig = {
  name: string
  url: string
}

type DesktopRuntimeStatus = `stopped` | `starting` | `running` | `error`

type DesktopState = {
  runtimeStatus: DesktopRuntimeStatus
  runtimeUrl: string | null
  activeServer: ServerConfig | null
  workingDirectory: string | null
  error: string | null
}

type DesktopSettings = {
  servers: Array<ServerConfig>
  activeServer: ServerConfig | null
  workingDirectory: string | null
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = path.resolve(MODULE_DIR, `..`)
const RENDERER_INDEX = path.resolve(
  PACKAGE_DIR,
  `../agents-server-ui/dist-desktop/index.html`
)
const PRELOAD_PATH = path.resolve(MODULE_DIR, `preload.cjs`)

const DEFAULT_SETTINGS: DesktopSettings = {
  servers: [],
  activeServer: null,
  workingDirectory: null,
}

let settings: DesktopSettings = { ...DEFAULT_SETTINGS }
let state: DesktopState = {
  runtimeStatus: `stopped`,
  runtimeUrl: null,
  activeServer: null,
  workingDirectory: null,
  error: null,
}
let runtime: BuiltinAgentsServer | null = null
let runtimeGeneration = 0
let tray: Tray | null = null
let isQuitting = false
const windows = new Set<BrowserWindow>()

function settingsPath(): string {
  return path.join(app.getPath(`userData`), `settings.json`)
}

function normalizeServer(value: unknown): ServerConfig | null {
  if (!value || typeof value !== `object`) return null
  const maybe = value as Partial<ServerConfig>
  if (typeof maybe.name !== `string` || typeof maybe.url !== `string`) {
    return null
  }
  const name = maybe.name.trim()
  const url = maybe.url.trim()
  if (!name || !url) return null
  try {
    new URL(url)
  } catch {
    return null
  }
  return { name, url }
}

function normalizeServers(value: unknown): Array<ServerConfig> {
  if (!Array.isArray(value)) return []
  const byUrl = new Map<string, ServerConfig>()
  for (const entry of value) {
    const server = normalizeServer(entry)
    if (server) byUrl.set(server.url, server)
  }
  return [...byUrl.values()]
}

function serverInList(
  server: ServerConfig | null,
  servers: Array<ServerConfig>
): boolean {
  return Boolean(server && servers.some((entry) => entry.url === server.url))
}

async function loadSettings(): Promise<void> {
  try {
    const raw = await readFile(settingsPath(), `utf8`)
    const parsed = JSON.parse(raw) as Partial<DesktopSettings>
    const servers = normalizeServers(parsed.servers)
    const activeServer = normalizeServer(parsed.activeServer)
    settings = {
      servers,
      activeServer: serverInList(activeServer, servers) ? activeServer : null,
      workingDirectory:
        typeof parsed.workingDirectory === `string`
          ? parsed.workingDirectory
          : null,
    }
  } catch {
    settings = { ...DEFAULT_SETTINGS }
  }

  state = {
    ...state,
    activeServer: settings.activeServer,
    workingDirectory: settings.workingDirectory,
  }
}

async function saveSettings(): Promise<void> {
  await mkdir(path.dirname(settingsPath()), { recursive: true })
  await writeFile(settingsPath(), JSON.stringify(settings, null, 2))
}

function statusLabel(status: DesktopRuntimeStatus): string {
  switch (status) {
    case `starting`:
      return `Starting`
    case `running`:
      return `Running`
    case `error`:
      return `Error`
    case `stopped`:
      return `Stopped`
  }
}

function createTrayIcon(): Electron.NativeImage {
  const icon = nativeImage.createFromDataURL(
    `data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=`
  )
  if (process.platform === `darwin`) {
    icon.setTemplateImage(true)
  }
  return icon
}

function updateTray(): void {
  if (!tray) return

  const runtimeLabel = statusLabel(state.runtimeStatus)
  const serverLabel = state.activeServer?.name ?? `No server selected`
  tray.setToolTip(`Electric Agents: ${runtimeLabel}`)

  const menu = Menu.buildFromTemplate([
    {
      label: `Open Agents`,
      click: () => createWindow(),
    },
    {
      label: `New Window`,
      click: () => createWindow(),
    },
    { type: `separator` },
    {
      label: `Runtime: ${runtimeLabel}`,
      enabled: false,
    },
    {
      label: `Server: ${serverLabel}`,
      enabled: false,
    },
    {
      label: `Restart Local Runtime`,
      enabled: Boolean(state.activeServer),
      click: () => {
        void restartRuntime()
      },
    },
    {
      label: `Stop Local Runtime`,
      enabled:
        state.runtimeStatus === `running` || state.runtimeStatus === `starting`,
      click: () => {
        void stopRuntime()
      },
    },
    { type: `separator` },
    {
      label: `Quit`,
      click: () => {
        void quitApp()
      },
    },
  ])

  tray.setContextMenu(menu)
}

function broadcastState(): void {
  for (const win of windows) {
    win.webContents.send(`desktop:state-changed`, state)
  }
}

function setState(patch: Partial<DesktopState>): void {
  state = { ...state, ...patch }
  updateTray()
  broadcastState()
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: `Electric Agents`,
    // macOS: hide the native titlebar but keep the traffic-light buttons
    // overlaid on the window content. The renderer paints the toolbar
    // with extra left-padding so its icons sit to the right of the
    // traffic lights and the row reads as a single chrome strip.
    // Other platforms get a frameless window with custom in-app
    // title bars.
    titleBarStyle: process.platform === `darwin` ? `hiddenInset` : `hidden`,
    frame: process.platform === `darwin`,
    // Standard macOS hiddenInset traffic-light origin (top-left of the
    // leftmost light). The renderer matches the 44px desktop header
    // height so the 24px IconButton glyphs flex-center to the same y as
    // the light centers — the row reads as a single chrome strip.
    trafficLightPosition:
      process.platform === `darwin` ? { x: 16, y: 14 } : undefined,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  windows.add(win)
  win.on(`closed`, () => {
    windows.delete(win)
  })
  win.webContents.setWindowOpenHandler(() => ({ action: `deny` }))
  void win.loadFile(RENDERER_INDEX)

  return win
}

function showOrCreateWindow(): void {
  const existing = [...windows].find((win) => !win.isDestroyed())
  if (existing) {
    existing.show()
    existing.focus()
    return
  }
  createWindow()
}

async function stopExistingRuntime(): Promise<void> {
  const current = runtime
  runtime = null
  if (current) {
    await current.stop()
  }
}

async function restartRuntime(): Promise<void> {
  const generation = ++runtimeGeneration
  await stopExistingRuntime()

  const activeServer = settings.activeServer
  if (!activeServer) {
    setState({ runtimeStatus: `stopped`, runtimeUrl: null, error: null })
    return
  }

  setState({ runtimeStatus: `starting`, runtimeUrl: null, error: null })

  const nextRuntime = new BuiltinAgentsServer({
    agentServerUrl: activeServer.url,
    host: `127.0.0.1`,
    port: 0,
    workingDirectory: settings.workingDirectory ?? app.getPath(`home`),
  })
  runtime = nextRuntime

  try {
    const runtimeUrl = await nextRuntime.start()
    if (generation !== runtimeGeneration) {
      await nextRuntime.stop()
      return
    }
    setState({ runtimeStatus: `running`, runtimeUrl, error: null })
  } catch (error) {
    if (runtime === nextRuntime) {
      runtime = null
    }
    setState({
      runtimeStatus: `error`,
      runtimeUrl: null,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

async function stopRuntime(): Promise<void> {
  runtimeGeneration += 1
  await stopExistingRuntime()
  setState({ runtimeStatus: `stopped`, runtimeUrl: null, error: null })
}

async function setActiveServer(server: ServerConfig | null): Promise<void> {
  const normalized = normalizeServer(server)
  settings.activeServer =
    normalized && serverInList(normalized, settings.servers) ? normalized : null
  setState({ activeServer: settings.activeServer })
  await saveSettings()
  await restartRuntime()
}

async function quitApp(): Promise<void> {
  if (isQuitting) return
  isQuitting = true
  await stopExistingRuntime().catch(() => {})
  app.quit()
}

function registerIpcHandlers(): void {
  ipcMain.handle(`desktop:get-servers`, () => settings.servers)
  ipcMain.handle(
    `desktop:save-servers`,
    async (_event, servers: Array<ServerConfig>) => {
      settings.servers = normalizeServers(servers)
      if (!serverInList(settings.activeServer, settings.servers)) {
        settings.activeServer = null
        setState({ activeServer: null })
        await restartRuntime()
      }
      await saveSettings()
    }
  )
  ipcMain.handle(`desktop:get-state`, () => state)
  ipcMain.handle(
    `desktop:set-active-server`,
    async (_event, server: ServerConfig | null) => {
      await setActiveServer(server)
    }
  )
  ipcMain.handle(`desktop:restart-runtime`, async () => {
    await restartRuntime()
  })
  ipcMain.handle(`desktop:stop-runtime`, async () => {
    await stopRuntime()
  })
  ipcMain.handle(
    `desktop:get-working-directory`,
    () => settings.workingDirectory
  )
  ipcMain.handle(`desktop:choose-working-directory`, async () => {
    const result = await dialog.showOpenDialog({
      properties: [`openDirectory`, `createDirectory`],
    })
    if (result.canceled) return settings.workingDirectory
    settings.workingDirectory = result.filePaths[0] ?? null
    setState({ workingDirectory: settings.workingDirectory })
    await saveSettings()
    if (settings.activeServer) {
      await restartRuntime()
    }
    return settings.workingDirectory
  })
}

async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on(`second-instance`, () => {
    showOrCreateWindow()
  })

  app.on(`window-all-closed`, () => {
    // Keep the tray/menu bar runtime alive until the user explicitly quits.
  })

  app.on(`activate`, () => {
    showOrCreateWindow()
  })

  app.on(`before-quit`, (event) => {
    if (isQuitting) return
    event.preventDefault()
    void quitApp()
  })

  await app.whenReady()
  await loadSettings()
  registerIpcHandlers()

  tray = new Tray(createTrayIcon())
  tray.on(`click`, () => showOrCreateWindow())
  updateTray()

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: `Electric Agents`,
        submenu: [
          { role: `about` },
          { type: `separator` },
          {
            label: `New Window`,
            accelerator: `CommandOrControl+N`,
            click: () => createWindow(),
          },
          { type: `separator` },
          { role: `hide` },
          { role: `hideOthers` },
          { role: `unhide` },
          { type: `separator` },
          {
            label: `Quit`,
            accelerator: `CommandOrControl+Q`,
            click: () => void quitApp(),
          },
        ],
      },
      {
        label: `Edit`,
        submenu: [
          { role: `undo` },
          { role: `redo` },
          { type: `separator` },
          { role: `cut` },
          { role: `copy` },
          { role: `paste` },
          { role: `selectAll` },
        ],
      },
      {
        label: `View`,
        submenu: [
          { role: `reload` },
          { role: `forceReload` },
          { role: `toggleDevTools` },
          { type: `separator` },
          { role: `resetZoom` },
          { role: `zoomIn` },
          { role: `zoomOut` },
          { type: `separator` },
          { role: `togglefullscreen` },
        ],
      },
    ])
  )

  createWindow()
  if (settings.activeServer) {
    void restartRuntime()
  }
}

void main()
