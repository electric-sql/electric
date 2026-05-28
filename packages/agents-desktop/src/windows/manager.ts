import { BrowserWindow } from 'electron'
import { DEV_SERVER_URL } from '../shared/constants'
import { PRELOAD_PATH, RENDERER_INDEX } from '../shared/paths'

export type WindowManagerDeps = {
  windows: Set<BrowserWindow>
  windowSelections: Map<number, string | null>
  defaultSelectedServerId: () => string | null
  installEditableContextMenu: (win: BrowserWindow) => void
  installExternalLinkHandler: (win: BrowserWindow) => void
  installNavigationStateBridge: (win: BrowserWindow) => void
  sendFullscreenState: (win: BrowserWindow) => void
  buildApplicationMenu: () => void
}

export function createWindow(deps: WindowManagerDeps): BrowserWindow {
  const isMac = process.platform === `darwin`
  const isWindows = process.platform === `win32`
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: `Electric Agents`,
    titleBarStyle: isMac ? `hiddenInset` : `hidden`,
    frame: true,
    autoHideMenuBar: !isMac,
    transparent: isMac,
    backgroundColor: isMac ? `#00000000` : undefined,
    vibrancy: isMac ? `sidebar` : undefined,
    visualEffectState: isMac ? `active` : undefined,
    backgroundMaterial: isWindows ? `mica` : undefined,
    titleBarOverlay: isMac
      ? undefined
      : {
          color: isWindows ? `#00000000` : `#f7f7f7`,
          symbolColor: `#1f2328`,
          height: 34,
        },
    trafficLightPosition: isMac ? { x: 16, y: 14 } : undefined,
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  if (isMac) {
    win.setVibrancy(`sidebar`)
  } else if (isWindows) {
    win.setBackgroundMaterial(`mica`)
  }

  deps.windows.add(win)
  deps.windowSelections.set(win.id, deps.defaultSelectedServerId())
  if (!isMac) {
    win.setMenuBarVisibility(false)
  }
  deps.installEditableContextMenu(win)
  deps.installExternalLinkHandler(win)
  deps.installNavigationStateBridge(win)
  win.on(`enter-full-screen`, () => deps.sendFullscreenState(win))
  win.on(`leave-full-screen`, () => deps.sendFullscreenState(win))
  win.webContents.on(`did-finish-load`, () => deps.sendFullscreenState(win))
  win.on(`closed`, () => {
    deps.windows.delete(win)
    deps.windowSelections.delete(win.id)
    deps.buildApplicationMenu()
  })
  win.webContents.on(`page-title-updated`, () => {
    deps.buildApplicationMenu()
  })
  win.on(`focus`, () => {
    deps.buildApplicationMenu()
  })
  if (DEV_SERVER_URL) {
    void win.loadURL(DEV_SERVER_URL)
  } else {
    void win.loadFile(RENDERER_INDEX)
  }
  deps.buildApplicationMenu()

  return win
}

export function showOrCreateWindow(
  windows: Set<BrowserWindow>,
  createWindowFn: () => BrowserWindow
): void {
  const existing = [...windows].find((win) => !win.isDestroyed())
  if (existing) {
    existing.show()
    existing.focus()
    return
  }
  createWindowFn()
}
