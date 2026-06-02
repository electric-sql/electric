import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BrowserWindow, app } from 'electron'
import { openAuthorizeWindow } from '../oauth-window'
import {
  removeMcpServerFromSettings,
  upsertMcpServerInSettings,
  validateMcpServerConfig,
} from '../settings/store'
import type {
  DesktopMcpServerRow,
  DesktopMcpSnapshot,
  DesktopSettings,
  McpServerConfig,
  RegistrySnapshot,
  RuntimeEntry,
} from '../shared/types'

export const EMPTY_MCP_SNAPSHOT: DesktopMcpSnapshot = { seq: 0, servers: [] }

/**
 * Sync-read the workspace `mcp.json` and return the set of server
 * names it declares. The file is small and reads are cheap; we re-read
 * on every snapshot broadcast rather than cache + watch because the
 * runtime already watches and re-applies when it changes.
 */
function readWorkspaceMcpNames(
  workingDirectory: string | null | undefined
): Set<string> {
  const dir = workingDirectory ?? app.getPath(`home`)
  try {
    const raw = readFileSync(path.join(dir, `mcp.json`), `utf8`)
    const parsed = JSON.parse(raw) as { servers?: Record<string, unknown> }
    const servers = parsed?.servers
    if (!servers || typeof servers !== `object`) return new Set()
    return new Set(Object.keys(servers))
  } catch {
    return new Set()
  }
}

/**
 * Combine the live registry snapshot with the desktop's settings.json
 * extras and the workspace mcp.json names to produce a UI-friendly
 * snapshot with provenance + shadowing baked in.
 *
 * Workspace `mcp.json` wins on name collision (same precedence the
 * runtime applies internally) — settings.json rows with a workspace
 * twin get an extra "shadowed" entry alongside the running workspace
 * one so the user understands why their global config isn't in effect.
 */
function enrichSnapshot(
  snapshot: RegistrySnapshot,
  settingsServers: ReadonlyArray<McpServerConfig>,
  workspaceNames: Set<string>
): DesktopMcpSnapshot {
  const settingsByName = new Map(settingsServers.map((s) => [s.name, s]))
  const rows: DesktopMcpServerRow[] = []

  for (const entry of snapshot.servers) {
    const isWorkspace = workspaceNames.has(entry.name)
    const settingsConfig = settingsByName.get(entry.name)
    const provenance = isWorkspace
      ? `workspace`
      : settingsConfig
        ? `settings`
        : `extras`
    rows.push({
      name: entry.name,
      status: entry.status,
      toolCount: entry.toolCount,
      transport: entry.transport,
      authMode: entry.authMode,
      authUrl: entry.authUrl,
      error: entry.error,
      tools: entry.tools as DesktopMcpServerRow[`tools`],
      provenance,
      shadowed: false,
      config: provenance === `settings` ? settingsConfig : undefined,
    })
  }

  // Fabricate "shadowed" rows for settings.json entries whose name is
  // claimed by workspace mcp.json — the registry doesn't see them at
  // all (workspace wins), but the UI surfaces them as a grayed-out
  // configured-but-overridden entry.
  const runningNames = new Set(snapshot.servers.map((s) => s.name))
  for (const cfg of settingsServers) {
    if (!workspaceNames.has(cfg.name)) continue
    if (!runningNames.has(cfg.name)) continue
    rows.push({
      name: cfg.name,
      status: `shadowed`,
      toolCount: 0,
      transport: cfg.transport,
      authMode: cfg.auth?.mode,
      provenance: `settings`,
      shadowed: true,
      config: cfg,
    })
  }

  return { seq: snapshot.seq, servers: rows }
}

/**
 * Compute and broadcast an enriched snapshot for a given runtime
 * entry. Reads workspace mcp.json synchronously each call (file is
 * tiny, callers are rare).
 */
export function broadcastEnrichedSnapshot(
  deps: {
    snapshots: Map<string, DesktopMcpSnapshot>
    windows: Set<BrowserWindow>
    settings: DesktopSettings
  },
  serverId: string,
  snapshot: RegistrySnapshot
): void {
  const enriched = enrichSnapshot(
    snapshot,
    deps.settings.mcp?.servers ?? [],
    readWorkspaceMcpNames(deps.settings.workingDirectory)
  )
  deps.snapshots.set(serverId, enriched)
  for (const win of deps.windows) {
    if (!win.isDestroyed()) {
      win.webContents.send(`desktop:mcp-state`, {
        serverId,
        snapshot: enriched,
      })
    }
  }
}

/**
 * Re-broadcast every connected runtime's snapshot — used after a
 * settings.json edit so the renderer picks up new provenance even when
 * the registry hasn't fired its own event.
 */
export function rebroadcastAllSnapshots(deps: {
  runtimeEntries: Map<string, RuntimeEntry>
  snapshots: Map<string, DesktopMcpSnapshot>
  windows: Set<BrowserWindow>
  settings: DesktopSettings
}): void {
  for (const [serverId, entry] of deps.runtimeEntries) {
    const reg = entry.runtime?.mcpRegistry
    if (!reg) continue
    const list = reg.list()
    const seq = deps.snapshots.get(serverId)?.seq ?? 0
    broadcastEnrichedSnapshot(deps, serverId, {
      seq,
      servers: list,
    } as RegistrySnapshot)
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
  snapshots: Map<string, DesktopMcpSnapshot>,
  serverId: string | null | undefined
): DesktopMcpSnapshot {
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

/**
 * Persist an Add or Edit of an MCP server in `settings.json mcp.servers`
 * and push the updated extras list to every live runtime so the registry
 * picks the change up without a restart.
 *
 * Resolves as soon as settings.json is on disk. The registry rebuild
 * (`setExtraMcpServers` → re-merge → transport teardown/rebuild → MCP
 * handshake → tool list) runs in the background — for stdio servers
 * that means several seconds we don't make the UI wait on. The row's
 * status will animate `connecting → ready` (or `error`) through the
 * registry's existing snapshot subscription.
 */
export async function upsertMcpServer(deps: {
  settings: DesktopSettings
  saveSettings: () => Promise<void>
  runtimeEntries: Map<string, RuntimeEntry>
  snapshots: Map<string, DesktopMcpSnapshot>
  windows: Set<BrowserWindow>
  cfg: McpServerConfig
}): Promise<void> {
  const error = validateMcpServerConfig(deps.cfg)
  if (error) throw new Error(error)
  upsertMcpServerInSettings(deps.settings, deps.cfg)
  await deps.saveSettings()
  // Rebroadcast first so the UI sees the new provenance/config (badges,
  // pre-fill for the next Edit, etc.) before the transport rebuild lands.
  rebroadcastAllSnapshots(deps)
  void applyExtrasToAllRuntimes(deps)
}

export async function removeMcpServer(deps: {
  settings: DesktopSettings
  saveSettings: () => Promise<void>
  runtimeEntries: Map<string, RuntimeEntry>
  snapshots: Map<string, DesktopMcpSnapshot>
  windows: Set<BrowserWindow>
  name: string
}): Promise<void> {
  const removed = removeMcpServerFromSettings(deps.settings, deps.name)
  if (!removed) return
  await deps.saveSettings()
  rebroadcastAllSnapshots(deps)
  void applyExtrasToAllRuntimes(deps)
}

async function applyExtrasToAllRuntimes(deps: {
  settings: DesktopSettings
  runtimeEntries: Map<string, RuntimeEntry>
}): Promise<void> {
  const extras = deps.settings.mcp?.servers ?? []
  await Promise.all(
    [...deps.runtimeEntries.values()].map(async (entry) => {
      const runtime = entry.runtime
      if (!runtime) return
      await runtime.setExtraMcpServers(extras).catch((err: unknown) => {
        console.warn(`[agents-desktop] setExtraMcpServers failed:`, err)
      })
    })
  )
}
