import { BrowserWindow, Menu, shell } from 'electron'
import {
  APP_DISPLAY_NAME,
  ELECTRIC_AGENTS_DOCS_URL,
  ELECTRIC_GITHUB_NEW_ISSUE_URL,
  ELECTRIC_GITHUB_URL,
} from '../shared/constants'
import type {
  DesktopCommand,
  DesktopMenuPopupBounds,
  DesktopMenuSection,
  DesktopMenuState,
} from '../shared/types'

export type ApplicationMenuDeps = {
  windows: Set<BrowserWindow>
  createWindow: () => BrowserWindow
  sendCommand: (command: DesktopCommand) => void
  quitApp: () => Promise<void>
  showAboutDialog: () => void
}

function windowDisplayLabel(win: BrowserWindow): string {
  const raw = win.getTitle()
  if (!raw) return APP_DISPLAY_NAME
  const suffix = ` — ${APP_DISPLAY_NAME}`
  if (raw.endsWith(suffix)) {
    return raw.slice(0, -suffix.length) || APP_DISPLAY_NAME
  }
  return raw
}

export function buildApplicationMenuTemplate(
  deps: ApplicationMenuDeps
): Array<Electron.MenuItemConstructorOptions> {
  const isMac = process.platform === `darwin`
  const focused = BrowserWindow.getFocusedWindow()
  const liveWindows = [...deps.windows].filter((win) => !win.isDestroyed())

  const fileSubmenu: Array<Electron.MenuItemConstructorOptions> = [
    {
      label: `New Chat`,
      accelerator: `CommandOrControl+N`,
      click: () => deps.sendCommand(`new-chat`),
    },
    {
      label: `New Window`,
      accelerator: `Shift+CommandOrControl+N`,
      click: () => deps.createWindow(),
    },
    ...(!isMac
      ? ([
          { type: `separator` },
          {
            label: `Settings…`,
            accelerator: `CommandOrControl+,`,
            click: () => deps.sendCommand(`open-settings`),
          },
        ] as Array<Electron.MenuItemConstructorOptions>)
      : []),
    { type: `separator` },
    {
      label: `Close Tile`,
      accelerator: `CommandOrControl+W`,
      click: () => deps.sendCommand(`close-tile`),
    },
    {
      label: `Close Window`,
      accelerator: `Shift+CommandOrControl+W`,
      role: `close`,
    },
  ]

  return [
    ...(isMac
      ? [
          {
            label: APP_DISPLAY_NAME,
            submenu: [
              { role: `about` as const },
              { type: `separator` as const },
              {
                label: `Settings…`,
                accelerator: `CommandOrControl+,`,
                click: () => deps.sendCommand(`open-settings`),
              },
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
                click: () => void deps.quitApp(),
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
        { type: `separator` },
        {
          label: `Find in Pane…`,
          accelerator: `CommandOrControl+F`,
          click: () => deps.sendCommand(`open-find`),
        },
        {
          label: `Find Next`,
          accelerator: `CommandOrControl+G`,
          click: () => deps.sendCommand(`find-next`),
        },
        {
          label: `Find Previous`,
          accelerator: `Shift+CommandOrControl+G`,
          click: () => deps.sendCommand(`find-previous`),
        },
      ],
    },
    {
      label: `View`,
      submenu: [
        {
          label: `Toggle Sidebar`,
          accelerator: `CommandOrControl+B`,
          click: () => deps.sendCommand(`toggle-sidebar`),
        },
        {
          label: `Search Sessions…`,
          accelerator: `CommandOrControl+K`,
          click: () => deps.sendCommand(`open-search`),
        },
        { type: `separator` },
        {
          label: `Split Right`,
          accelerator: `CommandOrControl+D`,
          click: () => deps.sendCommand(`split-right`),
        },
        {
          label: `Split Down`,
          accelerator: `Shift+CommandOrControl+D`,
          click: () => deps.sendCommand(`split-down`),
        },
        {
          label: `Cycle Tile`,
          accelerator: `CommandOrControl+\\`,
          click: () => deps.sendCommand(`cycle-tile`),
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
          click: () => deps.showAboutDialog(),
        },
        { type: `separator` },
        {
          label: `Electric Documentation`,
          click: () => {
            void shell.openExternal(ELECTRIC_AGENTS_DOCS_URL)
          },
        },
        {
          label: `Electric on GitHub`,
          click: () => {
            void shell.openExternal(ELECTRIC_GITHUB_URL)
          },
        },
        { type: `separator` },
        {
          label: `Report an Issue`,
          click: () => {
            void shell.openExternal(ELECTRIC_GITHUB_NEW_ISSUE_URL)
          },
        },
      ],
    },
  ]
}

export function buildApplicationMenu(deps: ApplicationMenuDeps): void {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(buildApplicationMenuTemplate(deps))
  )
}

export function popupApplicationMenuSection(
  deps: ApplicationMenuDeps,
  win: BrowserWindow,
  section: DesktopMenuSection,
  bounds: DesktopMenuPopupBounds,
  state: DesktopMenuState
): void {
  const item = buildApplicationMenuTemplate(deps).find(
    (candidate) => candidate.label === section
  )
  if (!item || !Array.isArray(item.submenu)) return

  Menu.buildFromTemplate(applyDesktopMenuState(item.submenu, state)).popup({
    window: win,
    x: Math.round(bounds.x),
    y: Math.round(bounds.y + bounds.height),
  })
}

export function popupAppIconMenu(
  deps: Pick<ApplicationMenuDeps, `showAboutDialog`>,
  win: BrowserWindow,
  bounds: DesktopMenuPopupBounds
): void {
  Menu.buildFromTemplate([
    {
      label: `About ${APP_DISPLAY_NAME}`,
      click: () => deps.showAboutDialog(),
    },
    {
      label: `Check for Updates…`,
      enabled: false,
    },
  ]).popup({
    window: win,
    x: Math.round(bounds.x),
    y: Math.round(bounds.y + bounds.height),
  })
}

function applyDesktopMenuState(
  items: Array<Electron.MenuItemConstructorOptions>,
  state: DesktopMenuState
): Array<Electron.MenuItemConstructorOptions> {
  const enabledByLabel = new Map<string, boolean>([
    [`Close Tile`, state.canCloseTile],
    [`Find in Pane…`, state.hasActiveTile],
    [`Find Next`, state.hasActiveTile],
    [`Find Previous`, state.hasActiveTile],
    [`Split Right`, state.canSplitTile],
    [`Split Down`, state.canSplitTile],
    [`Cycle Tile`, state.canCycleTile],
  ])

  return items.map((item) => {
    const next = { ...item }
    if (typeof item.label === `string` && enabledByLabel.has(item.label)) {
      next.enabled = enabledByLabel.get(item.label)
    }
    if (Array.isArray(item.submenu)) {
      next.submenu = applyDesktopMenuState(item.submenu, state)
    }
    return next
  })
}
