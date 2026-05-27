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
