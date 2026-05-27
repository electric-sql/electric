import { BrowserWindow } from 'electron'
import { openAuthorizeWindow } from '../oauth-window'
import type { RegistrySnapshot, RuntimeEntry } from '../shared/types'

export const EMPTY_MCP_SNAPSHOT: RegistrySnapshot = { seq: 0, servers: [] }

export function broadcastMcpSnapshot(
  deps: {
    snapshots: Map<string, RegistrySnapshot>
    windows: Set<BrowserWindow>
  },
  serverId: string,
  snapshot: RegistrySnapshot
): void {
  deps.snapshots.set(serverId, snapshot)
  for (const win of deps.windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(`desktop:mcp-state`, { serverId, snapshot })
    }
  }
}

export async function handleAuthorizeUrl(deps: {
  runtimeEntries: Map<string, RuntimeEntry>
  redirectBase: string
  serverId: string
  url: string
  server: string
}): Promise<void> {
  const reg = deps.runtimeEntries.get(deps.serverId)?.runtime?.mcpRegistry
  if (!reg) return
  const redirectUriPrefix = `${deps.redirectBase}/oauth/callback/${deps.server}`
  try {
    const focused = BrowserWindow.getFocusedWindow() ?? undefined
    const result = await openAuthorizeWindow({
      server: deps.server,
      authorizeUrl: deps.url,
      redirectUriPrefix,
      parent: focused ?? undefined,
    })
    await reg.finishAuth(result.server, result.code, result.state)
  } catch (err) {
    // Cancelled / closed without completing. The registry stays in
    // `authenticating`; the user can click Authorize again to retry.
    console.warn(`[agents-desktop] OAuth flow for ${deps.server}:`, err)
  }
}

export function getMcpSnapshot(
  snapshots: Map<string, RegistrySnapshot>,
  serverId: string | null | undefined
): RegistrySnapshot {
  return (serverId ? snapshots.get(serverId) : null) ?? EMPTY_MCP_SNAPSHOT
}

export async function authorizeMcpServer(
  runtimeEntries: Map<string, RuntimeEntry>,
  serverId: string | null | undefined,
  name: string
): Promise<void> {
  const reg = serverId
    ? runtimeEntries.get(serverId)?.runtime?.mcpRegistry
    : null
  await reg?.reauthorize(name).catch((err: unknown) => {
    console.warn(`[agents-desktop] mcp-authorize ${name}:`, err)
  })
}

export async function reconnectMcpServer(
  runtimeEntries: Map<string, RuntimeEntry>,
  serverId: string | null | undefined,
  name: string
): Promise<void> {
  const reg = serverId
    ? runtimeEntries.get(serverId)?.runtime?.mcpRegistry
    : null
  const entry = reg?.get(name)
  if (!reg || !entry) return
  await reg.addServer(entry.config).catch((err: unknown) => {
    console.warn(`[agents-desktop] mcp-reconnect ${name}:`, err)
  })
}

export async function disableMcpServer(
  runtimeEntries: Map<string, RuntimeEntry>,
  serverId: string | null | undefined,
  name: string
): Promise<void> {
  await runtimeEntries
    .get(serverId ?? ``)
    ?.runtime?.mcpRegistry?.disable(name)
    .catch((err: unknown) => {
      console.warn(`[agents-desktop] mcp-disable ${name}:`, err)
    })
}

export async function enableMcpServer(
  runtimeEntries: Map<string, RuntimeEntry>,
  serverId: string | null | undefined,
  name: string
): Promise<void> {
  await runtimeEntries
    .get(serverId ?? ``)
    ?.runtime?.mcpRegistry?.enable(name)
    .catch((err: unknown) => {
      console.warn(`[agents-desktop] mcp-enable ${name}:`, err)
    })
}
