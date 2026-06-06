import {
  Menu,
  Tray,
  nativeImage,
  type MenuItemConstructorOptions,
  type NativeImage,
} from 'electron'
import type {
  LocalRuntimeStatus,
  RuntimeEntry,
  ServerConfig,
  ServerConnectionStatus,
} from '../shared/types'

export function createTrayIcon(paths: {
  iconPath: string
  icon2xPath: string
}): NativeImage {
  // Electric brand mark rasterised to 26x22 (1x) and 51x44 (2x)
  // black-on-transparent PNGs in `assets/`. We add the @2x variant as
  // a representation so retina menu bars stay crisp; macOS template
  // mode then auto-recolors for light/dark menu bars.
  const icon = nativeImage.createFromPath(paths.iconPath)
  try {
    icon.addRepresentation({
      scaleFactor: 2,
      buffer: nativeImage.createFromPath(paths.icon2xPath).toPNG(),
    })
  } catch {
    // @2x asset missing - fall back to single-resolution.
  }
  if (process.platform === `darwin`) {
    icon.setTemplateImage(true)
  }
  return icon
}

export function createDesktopTray(
  icon: NativeImage,
  onClick: () => void
): Tray {
  const tray = new Tray(icon)
  tray.on(`click`, onClick)
  return tray
}

export type UpdateTrayDeps = {
  tray: Tray | null
  servers: Array<ServerConfig>
  runtimeEntries: Map<string, RuntimeEntry>
  ensureRuntimeEntry: (server: ServerConfig) => RuntimeEntry
  createWindow: () => void
  sendCommand: (command: `open-servers-settings`) => void
  connectServer: (serverId: string) => Promise<void>
  disconnectServer: (serverId: string) => Promise<void>
  saveSettings: () => Promise<void>
  preventAppSuspension: boolean
  setPreventAppSuspension: (enabled: boolean) => Promise<void>
  stopRuntimeEntry: (entry: RuntimeEntry) => Promise<void>
  restartRuntime: (serverId?: string | null) => Promise<void>
  refreshDesktopState: () => void
  quitApp: () => Promise<void>
}

export function updateTray(deps: UpdateTrayDeps): void {
  if (!deps.tray) return

  const connectedCount = [...deps.runtimeEntries.values()].filter(
    (entry) => entry.status === `connected`
  ).length
  const connectingCount = [...deps.runtimeEntries.values()].filter(
    (entry) => entry.status === `connecting` || entry.status === `reconnecting`
  ).length
  const runtimeLabel =
    connectedCount > 0
      ? `${connectedCount} connected`
      : connectingCount > 0
        ? `${connectingCount} connecting`
        : `No connected servers`
  deps.tray.setToolTip(`Electric Agents: ${runtimeLabel}`)

  const menu = Menu.buildFromTemplate([
    {
      label: `Open Agents`,
      click: () => deps.createWindow(),
    },
    {
      label: `New Window`,
      click: () => deps.createWindow(),
    },
    { type: `separator` },
    {
      label: `Keep Awake While Local Runtime Is Active`,
      type: `checkbox`,
      checked: deps.preventAppSuspension,
      click: (item) => {
        void deps.setPreventAppSuspension(item.checked).then(() => {
          deps.refreshDesktopState()
        })
      },
    },
    { type: `separator` },
    {
      label: `Servers: ${runtimeLabel}`,
      enabled: false,
    },
    ...deps.servers.map((server): MenuItemConstructorOptions => {
      const entry = deps.ensureRuntimeEntry(server)
      return {
        label: `${server.name}: ${connectionStatusLabel(entry.status)}`,
        submenu: [
          {
            label: `Connection: ${connectionStatusLabel(entry.status)}`,
            enabled: false,
          },
          {
            label: `Local runtime: ${localRuntimeStatusLabel(entry.localRuntimeStatus)}`,
            enabled: false,
          },
          ...(entry.runtimeUrl
            ? ([
                {
                  label: entry.runtimeUrl,
                  enabled: false,
                },
              ] as MenuItemConstructorOptions[])
            : []),
          ...(entry.runtimeError
            ? ([
                {
                  label: `Runtime error: ${entry.runtimeError}`,
                  enabled: false,
                },
              ] as MenuItemConstructorOptions[])
            : []),
          ...(entry.lastError
            ? ([
                {
                  label: `Connection error: ${entry.lastError}`,
                  enabled: false,
                },
              ] as MenuItemConstructorOptions[])
            : []),
          { type: `separator` },
          {
            label: `Server Settings...`,
            click: () => deps.sendCommand(`open-servers-settings`),
          },
          { type: `separator` },
          {
            label:
              entry.desiredState === `connected` ? `Disconnect` : `Connect`,
            click: () => {
              if (entry.desiredState === `connected`) {
                void deps.disconnectServer(server.id)
              } else {
                void deps.connectServer(server.id)
              }
            },
          },
          {
            label: server.localRuntimeEnabled
              ? `Disable Local Runtime`
              : `Enable Local Runtime`,
            click: () => {
              server.localRuntimeEnabled = !server.localRuntimeEnabled
              void deps.saveSettings().then(async () => {
                const nextEntry = deps.ensureRuntimeEntry(server)
                if (!server.localRuntimeEnabled && nextEntry.runtime) {
                  await deps.stopRuntimeEntry(nextEntry)
                } else if (
                  server.localRuntimeEnabled &&
                  server.desiredState === `connected`
                ) {
                  await deps.restartRuntime(server.id)
                }
                deps.refreshDesktopState()
              })
            },
          },
          {
            label: `Restart Local Runtime`,
            enabled:
              entry.desiredState === `connected` && server.localRuntimeEnabled,
            click: () => {
              void deps.restartRuntime(server.id)
            },
          },
        ],
      }
    }),
    { type: `separator` },
    {
      label: `Quit`,
      click: () => {
        void deps.quitApp()
      },
    },
  ])

  deps.tray.setContextMenu(menu)
}

function connectionStatusLabel(status: ServerConnectionStatus): string {
  switch (status) {
    case `connected`:
      return `Connected`
    case `connecting`:
      return `Connecting`
    case `reconnecting`:
      return `Reconnecting`
    case `offline`:
      return `Offline`
    case `error`:
      return `Error`
    case `disconnected`:
      return `Disconnected`
  }
}

function localRuntimeStatusLabel(status: LocalRuntimeStatus): string {
  switch (status) {
    case `disabled`:
      return `Disabled`
    case `stopped`:
      return `Stopped`
    case `starting`:
      return `Starting`
    case `running`:
      return `Running`
    case `error`:
      return `Error`
  }
}
