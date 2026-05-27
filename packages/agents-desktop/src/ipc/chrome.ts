import { BrowserWindow, ipcMain } from 'electron'
import { getNavigationState, navigateHistory } from '../windows/navigation'
import type {
  DesktopAppearance,
  DesktopContextMenuRequest,
  DesktopMenuPopupBounds,
  DesktopMenuSection,
  DesktopMenuState,
  DesktopNavigationState,
} from '../shared/types'

export type ChromeIpcDeps = {
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
}

export function registerChromeIpcHandlers(deps: ChromeIpcDeps): void {
  ipcMain.handle(
    `desktop:set-native-appearance`,
    (_event, appearance: DesktopAppearance) => {
      deps.applyNativeAppearance(appearance)
    }
  )
  ipcMain.on(
    `desktop:show-context-menu`,
    (event, request: DesktopContextMenuRequest) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      if (request.kind === `selection`) {
        deps.showSelectionContextMenu(win, request)
      }
    }
  )
  ipcMain.handle(
    `desktop:show-menu-section`,
    (
      event,
      section: DesktopMenuSection,
      bounds: DesktopMenuPopupBounds,
      menuState: DesktopMenuState
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      deps.popupApplicationMenuSection(win, section, bounds, menuState)
    }
  )
  ipcMain.handle(
    `desktop:show-app-menu`,
    (event, bounds: DesktopMenuPopupBounds) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      deps.popupAppIconMenu(win, bounds)
    }
  )
  ipcMain.handle(`desktop:get-navigation-state`, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win || win.isDestroyed()) {
      return {
        canGoBack: false,
        canGoForward: false,
      } satisfies DesktopNavigationState
    }
    return getNavigationState(win)
  })
  ipcMain.handle(
    `desktop:navigate-history`,
    (event, direction: `back` | `forward`) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      navigateHistory(win, direction)
    }
  )
}
