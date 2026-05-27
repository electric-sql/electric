import { BrowserWindow, ipcMain } from 'electron'
import type {
  DesktopAppearance,
  DesktopContextMenuRequest,
  DesktopMenuPopupBounds,
  DesktopMenuSection,
  DesktopMenuState,
  DesktopNavigationState,
} from '../shared/types'
import type { DesktopIpcDeps } from './types'

export function registerChromeIpcHandlers(deps: DesktopIpcDeps): void {
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
    return deps.getNavigationState(win)
  })
  ipcMain.handle(
    `desktop:navigate-history`,
    (event, direction: `back` | `forward`) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win || win.isDestroyed()) return
      deps.navigateHistory(win, direction)
    }
  )
}
