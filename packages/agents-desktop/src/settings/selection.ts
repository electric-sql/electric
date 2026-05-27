import type { BrowserWindow } from 'electron'
import { normalizeServer, serverInList } from './servers'
import type { DesktopSettings, ServerConfig } from '../shared/types'

export type ServerSelectionDeps = {
  settings: DesktopSettings
  windowSelections: Map<number, string | null>
  saveSettings: () => Promise<void>
  refreshDesktopState: () => void
}

export function findServer(
  deps: Pick<ServerSelectionDeps, `settings`>,
  serverId: string | null | undefined
): ServerConfig | null {
  if (!serverId) return null
  return deps.settings.servers.find((server) => server.id === serverId) ?? null
}

export function defaultSelectedServerId(
  deps: Pick<ServerSelectionDeps, `settings`>
): string | null {
  if (
    serverInList(
      findServer(deps, deps.settings.defaultServerId),
      deps.settings.servers
    )
  ) {
    return deps.settings.defaultServerId
  }
  return deps.settings.servers[0]?.id ?? null
}

export function selectedServerIdForWindow(
  deps: Pick<ServerSelectionDeps, `settings` | `windowSelections`>,
  win: BrowserWindow | null
): string | null {
  if (win && !win.isDestroyed()) {
    const existing = deps.windowSelections.get(win.id)
    if (existing && findServer(deps, existing)) return existing
  }
  return defaultSelectedServerId(deps)
}

export async function setSelectedServerForWindow(
  deps: ServerSelectionDeps,
  win: BrowserWindow | null,
  serverId: string | null
): Promise<void> {
  const next = findServer(deps, serverId)?.id ?? null
  if (win && !win.isDestroyed()) {
    deps.windowSelections.set(win.id, next)
  }
  deps.settings.defaultServerId = next
  await deps.saveSettings()
  deps.refreshDesktopState()
}

export async function setActiveServer(
  deps: ServerSelectionDeps,
  win: BrowserWindow | null,
  server: ServerConfig | null
): Promise<void> {
  const normalized = normalizeServer(server)
  const existing =
    normalized &&
    deps.settings.servers.find(
      (candidate) =>
        candidate.id === normalized.id || candidate.url === normalized.url
    )
  await setSelectedServerForWindow(deps, win, existing?.id ?? null)
}
