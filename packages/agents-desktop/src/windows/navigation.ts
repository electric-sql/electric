import type { BrowserWindow } from 'electron'
import type { DesktopNavigationState } from '../shared/types'

export function getNavigationState(win: BrowserWindow): DesktopNavigationState {
  return {
    canGoBack: win.webContents.canGoBack(),
    canGoForward: win.webContents.canGoForward(),
  }
}

export function sendNavigationState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.send(
    `desktop:navigation-state-changed`,
    getNavigationState(win)
  )
}

export function sendFullscreenState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  win.webContents.send(`desktop:fullscreen-state-changed`, win.isFullScreen())
}

export function installNavigationStateBridge(win: BrowserWindow): void {
  const notify = () => sendNavigationState(win)
  win.webContents.on(`did-finish-load`, notify)
  win.webContents.on(`did-navigate`, notify)
  win.webContents.on(`did-navigate-in-page`, notify)
}

export function navigateHistory(
  win: BrowserWindow,
  direction: `back` | `forward`
): void {
  if (direction === `back` && win.webContents.canGoBack()) {
    win.webContents.goBack()
  } else if (direction === `forward` && win.webContents.canGoForward()) {
    win.webContents.goForward()
  }
  sendNavigationState(win)
}
