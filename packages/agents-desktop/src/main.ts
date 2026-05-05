import { BuiltinAgentsServer } from '@electric-ax/agents'
import {
  BrowserWindow,
  Menu,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeImage,
  shell,
} from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

type ServerConfig = {
  name: string
  url: string
}

type DesktopRuntimeStatus = `stopped` | `starting` | `running` | `error`

type DiscoveredServer = {
  url: string
  port: number
  /** Epoch ms — when we last saw a healthy `/_electric/health` response. */
  lastSeen: number
}

type DesktopState = {
  runtimeStatus: DesktopRuntimeStatus
  runtimeUrl: string | null
  activeServer: ServerConfig | null
  workingDirectory: string | null
  error: string | null
  /**
   * Agents-server instances detected on this machine via the periodic
   * localhost scan in `runDiscovery()`. Renderers (e.g. `ServerPicker`)
   * surface these as one-click "add" suggestions.
   */
  discoveredServers: Array<DiscoveredServer>
}

type ApiKeys = {
  anthropic: string | null
  openai: string | null
  /**
   * Optional. Mirrored to `BRAVE_SEARCH_API_KEY` so Horton's
   * `brave_search` tool can call the Brave API directly. When unset
   * Horton falls back to Anthropic's built-in web search (which uses
   * the Anthropic key). Because it's optional, missing brave never
   * triggers the first-launch dialog on its own.
   */
  brave: string | null
}

type DesktopSettings = {
  servers: Array<ServerConfig>
  activeServer: ServerConfig | null
  workingDirectory: string | null
  /**
   * LLM provider API keys persisted in `settings.json` and applied to
   * `process.env` so the bundled `BuiltinAgentsServer` (Horton) picks
   * them up. Read by `applyApiKeys()` and surfaced to the renderer
   * via `desktop:get-api-keys-status` for the first-launch prompt.
   */
  apiKeys: ApiKeys
}

/**
 * Payload returned by `desktop:get-api-keys-status`. The renderer
 * uses `saved` to seed the first-launch dialog (or skip showing it
 * when keys already exist) and `suggested` to pre-fill empty fields
 * with whatever was found in `process.env` at startup — making it a
 * one-click confirmation flow for users who already export their
 * keys from a shell rc file.
 */
type ApiKeysStatus = {
  hasAnyKey: boolean
  saved: ApiKeys
  suggested: ApiKeys
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = path.resolve(MODULE_DIR, `..`)
const RENDERER_INDEX = path.resolve(
  PACKAGE_DIR,
  `../agents-server-ui/dist-desktop/index.html`
)
const PRELOAD_PATH = path.resolve(MODULE_DIR, `preload.cjs`)
const TRAY_ICON_PATH = path.resolve(PACKAGE_DIR, `assets/trayTemplate.png`)
const TRAY_ICON_2X_PATH = path.resolve(
  PACKAGE_DIR,
  `assets/trayTemplate@2x.png`
)
const APP_ICON_PATH = path.resolve(PACKAGE_DIR, `assets/icon.png`)
const APP_DISPLAY_NAME = `Electric Agents`

/**
 * When set, the renderer is loaded from this dev-server URL instead
 * of the prebuilt `dist-desktop/index.html` file. Wired up by the
 * `dev` script in `package.json`, which boots Vite on port 5174 and
 * exports `ELECTRIC_DESKTOP_DEV_SERVER_URL=http://localhost:5174`
 * so the renderer gets full HMR. Unset in `start` / packaged builds,
 * so production keeps loading the static bundle from disk.
 */
const DEV_SERVER_URL = process.env.ELECTRIC_DESKTOP_DEV_SERVER_URL ?? null

/**
 * Commands sent from the menu / tray (main process) to the focused
 * renderer over the `desktop:command` IPC channel. The renderer
 * subscribes via `window.electronAPI.onDesktopCommand` and dispatches
 * to the matching app action (sidebar toggle, search palette, new
 * chat, close active tile…). Keeping the menu definitions in main and
 * the action implementations in the renderer means the same actions
 * stay reachable from in-app buttons / hotkeys when running in a
 * regular browser.
 */
type DesktopCommand =
  | `new-chat`
  | `close-tile`
  | `toggle-sidebar`
  | `open-search`
  | `split-right`
  | `split-down`
  | `cycle-tile`

const DEFAULT_SETTINGS: DesktopSettings = {
  servers: [],
  activeServer: null,
  workingDirectory: null,
  apiKeys: { anthropic: null, openai: null, brave: null },
}

/**
 * Snapshot of provider API keys as they were when the app launched.
 * Captured before `applyApiKeys()` overwrites the live env so
 * `desktop:get-api-keys-status` can offer them as one-click
 * suggestions when the user hasn't saved any keys yet.
 *
 * Recapturing on every status query would defeat the purpose: by
 * then `applyApiKeys()` has already mirrored the saved values into
 * `process.env`, which would loop back as a "suggestion" identical
 * to the saved value.
 */
const ENV_API_KEYS_SNAPSHOT: ApiKeys = {
  anthropic: process.env.ANTHROPIC_API_KEY?.trim() || null,
  openai: process.env.OPENAI_API_KEY?.trim() || null,
  brave: process.env.BRAVE_SEARCH_API_KEY?.trim() || null,
}

let settings: DesktopSettings = { ...DEFAULT_SETTINGS }
let state: DesktopState = {
  runtimeStatus: `stopped`,
  runtimeUrl: null,
  activeServer: null,
  workingDirectory: null,
  error: null,
  discoveredServers: [],
}
let runtime: BuiltinAgentsServer | null = null
let runtimeGeneration = 0
let tray: Tray | null = null
let aboutWindow: BrowserWindow | null = null
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

function normalizeApiKeys(value: unknown): ApiKeys {
  if (!value || typeof value !== `object`) {
    return { anthropic: null, openai: null, brave: null }
  }
  const maybe = value as Partial<Record<keyof ApiKeys, unknown>>
  const pick = (raw: unknown): string | null => {
    if (typeof raw !== `string`) return null
    const trimmed = raw.trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return {
    anthropic: pick(maybe.anthropic),
    openai: pick(maybe.openai),
    brave: pick(maybe.brave),
  }
}

/**
 * Mirror persisted API keys into `process.env` so the bundled
 * `BuiltinAgentsServer` (Horton) — which reads them via
 * `process.env.ANTHROPIC_API_KEY` / `OPENAI_API_KEY` directly inside
 * `createBuiltinAgentHandler` — sees them on its next start. Saved
 * values take precedence; for slots the user hasn't saved yet we fall
 * back to whatever was in the launch environment so external `.env` /
 * shell setups keep working until the user opts in via the dialog.
 */
function applyApiKeys(): void {
  const resolveSlot = (
    saved: string | null,
    env: string | null,
    name: `ANTHROPIC_API_KEY` | `OPENAI_API_KEY` | `BRAVE_SEARCH_API_KEY`
  ): void => {
    const value = saved ?? env
    if (value) {
      process.env[name] = value
    } else {
      delete process.env[name]
    }
  }
  resolveSlot(
    settings.apiKeys.anthropic,
    ENV_API_KEYS_SNAPSHOT.anthropic,
    `ANTHROPIC_API_KEY`
  )
  resolveSlot(
    settings.apiKeys.openai,
    ENV_API_KEYS_SNAPSHOT.openai,
    `OPENAI_API_KEY`
  )
  resolveSlot(
    settings.apiKeys.brave,
    ENV_API_KEYS_SNAPSHOT.brave,
    `BRAVE_SEARCH_API_KEY`
  )
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
      apiKeys: normalizeApiKeys(parsed.apiKeys),
    }
  } catch {
    settings = { ...DEFAULT_SETTINGS }
  }

  state = {
    ...state,
    activeServer: settings.activeServer,
    workingDirectory: settings.workingDirectory,
  }

  applyApiKeys()
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

function sendCommand(command: DesktopCommand): void {
  const focused = BrowserWindow.getFocusedWindow()
  const target =
    focused ?? [...windows].find((win) => !win.isDestroyed()) ?? null
  target?.webContents.send(`desktop:command`, command)
}

function createTrayIcon(): Electron.NativeImage {
  // Electric brand mark rasterised to 26×22 (1×) and 51×44 (2×)
  // black-on-transparent PNGs in `assets/`. We add the @2x variant as
  // a representation so retina menu bars stay crisp; macOS template
  // mode then auto-recolors for light/dark menu bars.
  const icon = nativeImage.createFromPath(TRAY_ICON_PATH)
  try {
    icon.addRepresentation({
      scaleFactor: 2,
      buffer: nativeImage.createFromPath(TRAY_ICON_2X_PATH).toPNG(),
    })
  } catch {
    // @2x asset missing — fall back to single-resolution.
  }
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
    buildApplicationMenu()
  })
  // The renderer keeps `document.title` in sync with the active tile's
  // entity (see `useDocumentTitle.ts`). Forwarding `page-title-updated`
  // into a menu rebuild lets the Window submenu show one entry per
  // open window labelled with that window's active session.
  win.webContents.on(`page-title-updated`, () => {
    buildApplicationMenu()
  })
  win.on(`focus`, () => {
    buildApplicationMenu()
  })
  win.webContents.setWindowOpenHandler(() => ({ action: `deny` }))
  // Dev: load from the running Vite dev server so the renderer gets
  // HMR (CSS / React Refresh / module replacement). Production: load
  // the prebuilt `dist-desktop/index.html` from disk via file://.
  // DevTools are not auto-opened — multi-window setups would spawn
  // a detached DevTools per window, which gets noisy fast. The
  // standard `View → Toggle Developer Tools` menu item (Cmd+Opt+I /
  // Ctrl+Shift+I) works in every window when you actually need it.
  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
  } else {
    void win.loadFile(RENDERER_INDEX)
  }
  buildApplicationMenu()

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

function getApiKeysStatus(): ApiKeysStatus {
  const saved = settings.apiKeys
  // Brave is optional (falls back to Anthropic built-in search), so
  // it doesn't count toward "the app is configured" — the dialog
  // only auto-opens when the user has no LLM provider key at all.
  const hasAnyKey = Boolean(saved.anthropic || saved.openai)
  // Only suggest env values for slots the user hasn't already saved
  // — once they've persisted a key for a provider, the dialog should
  // show their saved value rather than the (potentially different)
  // environment value.
  const suggested: ApiKeys = {
    anthropic: saved.anthropic ? null : ENV_API_KEYS_SNAPSHOT.anthropic,
    openai: saved.openai ? null : ENV_API_KEYS_SNAPSHOT.openai,
    brave: saved.brave ? null : ENV_API_KEYS_SNAPSHOT.brave,
  }
  return { hasAnyKey, saved, suggested }
}

async function setApiKeys(next: ApiKeys): Promise<void> {
  settings.apiKeys = normalizeApiKeys(next)
  applyApiKeys()
  await saveSettings()
  if (settings.activeServer) {
    await restartRuntime()
  }
}

async function setActiveServer(server: ServerConfig | null): Promise<void> {
  const normalized = normalizeServer(server)
  const next =
    normalized && serverInList(normalized, settings.servers) ? normalized : null
  // Renderer mount fires `saveActiveServer(active)` even when the
  // value didn't actually change (React 19 StrictMode also double-
  // fires the effect in dev). Bail early when the active server is
  // identical to what we already had so we don't tear down and
  // restart Horton on every window open.
  const same =
    (next === null && settings.activeServer === null) ||
    (next !== null &&
      settings.activeServer !== null &&
      next.url === settings.activeServer.url &&
      next.name === settings.activeServer.name)
  settings.activeServer = next
  setState({ activeServer: settings.activeServer })
  await saveSettings()
  if (!same) {
    await restartRuntime()
  }
}

async function quitApp(): Promise<void> {
  if (isQuitting) return
  isQuitting = true
  stopDiscoveryLoop()
  await stopExistingRuntime().catch(() => {})
  app.quit()
}

/**
 * Localhost ports we probe for running `agents-server` instances.
 *
 * - 4437: `packages/agents-server` `DEFAULT_PORT`.
 * - 4438/4439: common offsets when running multiple servers side-by-side.
 * - 3000/4000/8080: common Node/dev defaults users sometimes pick.
 *
 * Identification is via `GET /_electric/health` returning
 * `{ status: "ok" }` (see `ElectricAgentsServer.handleRequestInner`),
 * so collisions with unrelated services on these ports are filtered out.
 */
const DISCOVERY_PORTS: ReadonlyArray<number> = [
  4437, 4438, 4439, 3000, 4000, 8080,
]
const DISCOVERY_TIMEOUT_MS = 1500
const DISCOVERY_INTERVAL_MS = 30_000

let discoveryTimer: NodeJS.Timeout | null = null
let discoveryInFlight: Promise<void> | null = null

async function probeAgentsServer(url: string): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DISCOVERY_TIMEOUT_MS)
  try {
    const res = await fetch(`${url}/_electric/health`, {
      signal: controller.signal,
      headers: { accept: `application/json` },
    })
    if (!res.ok) return false
    const json = (await res.json()) as { status?: unknown }
    return json?.status === `ok`
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function runDiscovery(): Promise<void> {
  if (discoveryInFlight) {
    await discoveryInFlight
    return
  }
  discoveryInFlight = (async () => {
    // Don't probe the bundled runtime URL — that's our own Horton
    // process and isn't a separate agents-server.
    const skip = state.runtimeUrl ? new URL(state.runtimeUrl).port : null
    const results = await Promise.all(
      DISCOVERY_PORTS.map(async (port) => {
        if (skip && String(port) === skip) return null
        const url = `http://127.0.0.1:${port}`
        const ok = await probeAgentsServer(url)
        return ok ? { url, port, lastSeen: Date.now() } : null
      })
    )
    const found = results.filter(
      (entry): entry is DiscoveredServer => entry !== null
    )
    found.sort((a, b) => a.port - b.port)

    const prev = state.discoveredServers
    const same =
      prev.length === found.length &&
      prev.every((entry, i) => entry.url === found[i]?.url)
    if (same) {
      // Same set of URLs — keep prior `lastSeen` to avoid noisy
      // broadcasts to renderers every tick.
      return
    }
    setState({ discoveredServers: found })
  })()
  try {
    await discoveryInFlight
  } finally {
    discoveryInFlight = null
  }
}

function startDiscoveryLoop(): void {
  if (discoveryTimer) return
  void runDiscovery()
  discoveryTimer = setInterval(() => {
    void runDiscovery()
  }, DISCOVERY_INTERVAL_MS)
}

function stopDiscoveryLoop(): void {
  if (discoveryTimer) {
    clearInterval(discoveryTimer)
    discoveryTimer = null
  }
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
  ipcMain.handle(`desktop:rescan-servers`, async () => {
    await runDiscovery()
    return state.discoveredServers
  })
  ipcMain.handle(`desktop:get-api-keys-status`, () => getApiKeysStatus())
  ipcMain.handle(`desktop:save-api-keys`, async (_event, keys: ApiKeys) => {
    await setApiKeys(keys)
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
  // One-shot directory picker — does NOT mutate the runtime cwd or
  // restart anything. Used by the new-session screen so each spawned
  // session can carry its own `workingDirectory` spawn arg without
  // disturbing the global default. Returns `null` on cancel; caller
  // is responsible for treating the result as ephemeral and (if it
  // wants to remember it) plumbing it into recent-dirs storage.
  ipcMain.handle(
    `desktop:pick-directory`,
    async (_event, options?: { defaultPath?: string }) => {
      const result = await dialog.showOpenDialog({
        properties: [`openDirectory`, `createDirectory`],
        defaultPath: options?.defaultPath,
      })
      if (result.canceled) return null
      return result.filePaths[0] ?? null
    }
  )
}

function windowDisplayLabel(win: BrowserWindow): string {
  const raw = win.getTitle()
  if (!raw) return APP_DISPLAY_NAME
  // The renderer formats titles as `${session} — Electric Agents`.
  // Strip the suffix so the Window submenu reads cleanly as just the
  // session name (the menu already lives under "Electric Agents").
  const suffix = ` — ${APP_DISPLAY_NAME}`
  if (raw.endsWith(suffix)) {
    return raw.slice(0, -suffix.length) || APP_DISPLAY_NAME
  }
  return raw
}

/**
 * Custom About panel rendered as a small frameless `BrowserWindow`.
 *
 * The macOS native About panel only honours `iconPath` on Linux /
 * Windows — on darwin it always shows the bundle icon, which during
 * `electron .` dev mode is Electron's default atom. A standalone
 * window lets us show the real Electric mark and consistent
 * brand copy on every platform.
 */
function showAboutDialog(): void {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.focus()
    return
  }

  const iconBase64 = (() => {
    try {
      return readFileSync(APP_ICON_PATH).toString(`base64`)
    } catch {
      return ``
    }
  })()
  const iconSrc = iconBase64 ? `data:image/png;base64,${iconBase64}` : ``

  const html = `<!doctype html>
<html lang="en" data-electric-desktop="true">
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="light dark" />
<title>About ${APP_DISPLAY_NAME}</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #f7f8fa;
    --fg: #15161a;
    --fg-muted: #6b6f78;
    --link: #1d6cff;
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #1c1e22; --fg: #f1f2f4; --fg-muted: #a3a8b2; --link: #6aa3ff; }
  }
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: var(--bg); color: var(--fg);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    user-select: none;
    -webkit-user-select: none;
    overflow: hidden;
    -webkit-app-region: drag;
  }
  main {
    display: flex; flex-direction: column; align-items: center;
    text-align: center; padding: 36px 28px 22px;
    gap: 10px;
  }
  .icon { width: 96px; height: 96px; image-rendering: -webkit-optimize-contrast; }
  .name { font-size: 19px; font-weight: 600; margin: 6px 0 0; letter-spacing: -0.01em; }
  .version { font-size: 12px; color: var(--fg-muted); margin: 0; }
  .tagline {
    font-size: 13px; font-weight: 500; margin: 14px 0 0;
    line-height: 1.45; max-width: 300px;
  }
  .body {
    font-size: 12px; color: var(--fg-muted); margin: 8px 0 0;
    line-height: 1.55; max-width: 300px;
  }
  .meta {
    font-size: 11px; color: var(--fg-muted);
    margin: 18px 0 0;
    display: flex; flex-direction: column; gap: 4px;
  }
  a {
    color: var(--link); text-decoration: none;
    -webkit-app-region: no-drag;
  }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
  <main>
    ${iconSrc ? `<img class="icon" src="${iconSrc}" alt="${APP_DISPLAY_NAME}" />` : ``}
    <h1 class="name">${APP_DISPLAY_NAME}</h1>
    <p class="version">Version ${app.getVersion() || `dev`}</p>
    <p class="tagline">The durable runtime for long-lived agents.</p>
    <p class="body">
      Built on Electric Streams, every agent sleeps when idle, wakes on
      demand and survives restarts — bringing durable, composable,
      serverless agents to the infrastructure you already run.
    </p>
    <div class="meta">
      <a href="https://electric.ax/agents/" target="_blank" rel="noreferrer">electric.ax/agents</a>
      <span>© ${new Date().getFullYear()} Electric DB Limited</span>
    </div>
  </main>
</body>
</html>`

  const win = new BrowserWindow({
    width: 380,
    height: 460,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: `About ${APP_DISPLAY_NAME}`,
    titleBarStyle: process.platform === `darwin` ? `hiddenInset` : `default`,
    trafficLightPosition:
      process.platform === `darwin` ? { x: 12, y: 12 } : undefined,
    backgroundColor: `#f7f8fa`,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  aboutWindow = win
  win.setMenuBarVisibility(false)
  win.on(`closed`, () => {
    if (aboutWindow === win) aboutWindow = null
  })
  win.once(`ready-to-show`, () => win.show())
  // Open external links (electric.ax/agents) in the user's browser
  // instead of inside this little About window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: `deny` }
  })
  win.webContents.on(`will-navigate`, (event, url) => {
    if (url === win.webContents.getURL()) return
    event.preventDefault()
    void shell.openExternal(url)
  })
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
}

function buildApplicationMenu(): void {
  const isMac = process.platform === `darwin`
  const focused = BrowserWindow.getFocusedWindow()
  const liveWindows = [...windows].filter((win) => !win.isDestroyed())

  // Sub-menu shared between File on Win/Linux and the application menu
  // on macOS. Each item maps to a renderer command implemented in the
  // shared `agents-server-ui` (see hooks under `src/hooks/`) so the
  // behaviour stays identical to the in-app buttons / hotkeys.
  const fileSubmenu: Array<Electron.MenuItemConstructorOptions> = [
    {
      label: `New Chat`,
      accelerator: `CommandOrControl+N`,
      click: () => sendCommand(`new-chat`),
    },
    {
      label: `New Window`,
      accelerator: `Shift+CommandOrControl+N`,
      click: () => createWindow(),
    },
    { type: `separator` },
    {
      label: `Close Tile`,
      accelerator: `CommandOrControl+W`,
      click: () => sendCommand(`close-tile`),
    },
    {
      label: `Close Window`,
      accelerator: `Shift+CommandOrControl+W`,
      role: `close`,
    },
  ]

  const template: Array<Electron.MenuItemConstructorOptions> = [
    ...(isMac
      ? [
          {
            label: APP_DISPLAY_NAME,
            submenu: [
              { role: `about` as const },
              { type: `separator` as const },
              { role: `services` as const },
              { type: `separator` as const },
              { role: `hide` as const },
              { role: `hideOthers` as const },
              { role: `unhide` as const },
              { type: `separator` as const },
              {
                label: `Quit ${APP_DISPLAY_NAME}`,
                accelerator: `CommandOrControl+Q`,
                click: () => void quitApp(),
              },
            ],
          },
        ]
      : []),
    {
      label: `File`,
      submenu: fileSubmenu,
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
        ...(isMac
          ? [
              { role: `pasteAndMatchStyle` as const },
              { role: `delete` as const },
            ]
          : [{ role: `delete` as const }]),
        { role: `selectAll` },
      ],
    },
    {
      label: `View`,
      submenu: [
        {
          label: `Toggle Sidebar`,
          accelerator: `CommandOrControl+B`,
          click: () => sendCommand(`toggle-sidebar`),
        },
        {
          label: `Search Sessions…`,
          accelerator: `CommandOrControl+K`,
          click: () => sendCommand(`open-search`),
        },
        { type: `separator` },
        {
          label: `Split Right`,
          accelerator: `CommandOrControl+D`,
          click: () => sendCommand(`split-right`),
        },
        {
          label: `Split Down`,
          accelerator: `Shift+CommandOrControl+D`,
          click: () => sendCommand(`split-down`),
        },
        {
          label: `Cycle Tile`,
          accelerator: `CommandOrControl+\\`,
          click: () => sendCommand(`cycle-tile`),
        },
        { type: `separator` },
        { role: `togglefullscreen` },
        { role: `resetZoom` },
        { role: `zoomIn` },
        { role: `zoomOut` },
        { type: `separator` },
        { role: `reload` },
        { role: `forceReload` },
        { role: `toggleDevTools` },
      ],
    },
    {
      label: `Window`,
      submenu: [
        { role: `minimize` },
        { role: `zoom` },
        ...(isMac
          ? [{ type: `separator` as const }, { role: `front` as const }]
          : [{ role: `close` as const }]),
        ...(liveWindows.length > 0
          ? ([
              { type: `separator` },
              ...liveWindows.map(
                (win): Electron.MenuItemConstructorOptions => ({
                  label: windowDisplayLabel(win),
                  type: `checkbox`,
                  checked: win === focused,
                  click: () => {
                    if (win.isDestroyed()) return
                    if (win.isMinimized()) win.restore()
                    win.show()
                    win.focus()
                  },
                })
              ),
            ] as Array<Electron.MenuItemConstructorOptions>)
          : []),
      ],
    },
    {
      label: `Help`,
      submenu: [
        {
          label: `About ${APP_DISPLAY_NAME}`,
          click: () => showAboutDialog(),
        },
        { type: `separator` },
        {
          label: `Electric Documentation`,
          click: () => {
            void shell.openExternal(`https://electric-sql.com/docs/agents`)
          },
        },
        {
          label: `Electric on GitHub`,
          click: () => {
            void shell.openExternal(`https://github.com/electric-sql/electric`)
          },
        },
        { type: `separator` },
        {
          label: `Report an Issue`,
          click: () => {
            void shell.openExternal(
              `https://github.com/electric-sql/electric/issues/new`
            )
          },
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function main(): Promise<void> {
  // Make sure macOS shows the product name everywhere (about menu,
  // dock tooltip, default window title) instead of the npm package id.
  app.setName(APP_DISPLAY_NAME)

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

  // Re-render the menu when focus changes so the Window submenu's
  // checkmark moves to the now-focused window.
  app.on(`browser-window-focus`, () => buildApplicationMenu())
  app.on(`browser-window-blur`, () => buildApplicationMenu())

  app.on(`before-quit`, (event) => {
    if (isQuitting) return
    event.preventDefault()
    void quitApp()
  })

  await app.whenReady()
  await loadSettings()
  registerIpcHandlers()

  app.setAboutPanelOptions({
    applicationName: APP_DISPLAY_NAME,
    applicationVersion: app.getVersion() || `dev`,
    version: app.getVersion() || `dev`,
    copyright: `© ${new Date().getFullYear()} Electric DB Limited`,
    website: `https://electric.ax/agents`,
    // `iconPath` only affects Linux/Windows. macOS shows the app
    // bundle icon, which during dev is the Electron atom — we surface
    // the proper Electric mark via the custom About window instead.
    iconPath: APP_ICON_PATH,
    credits: `The durable runtime for long-lived agents.`,
  })

  // Dock icon on macOS — replaces the default Electron icon during
  // `electron .` dev. (Linux/Windows package icons are wired via the
  // builder config when we add packaging.)
  if (process.platform === `darwin` && app.dock) {
    try {
      const dockIcon = nativeImage.createFromPath(APP_ICON_PATH)
      if (!dockIcon.isEmpty()) {
        app.dock.setIcon(dockIcon)
      }
    } catch {
      // Non-fatal — dev still works with the default Electron icon.
    }
  }

  const trayIcon = createTrayIcon()
  if (trayIcon.isEmpty()) {
    console.error(
      `[agents-desktop] Tray icon failed to load from ${TRAY_ICON_PATH}; ` +
        `the menu bar item may be invisible.`
    )
  }
  tray = new Tray(trayIcon)
  tray.on(`click`, () => showOrCreateWindow())
  updateTray()

  buildApplicationMenu()

  createWindow()
  if (settings.activeServer) {
    void restartRuntime()
  }
  startDiscoveryLoop()
}

void main()
