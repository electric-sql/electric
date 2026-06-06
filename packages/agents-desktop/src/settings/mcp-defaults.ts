import { upsertMcpServerInSettings } from './store'
import type { DesktopSettings, McpServerConfig } from '../shared/types'

/**
 * Built-in MCP servers we seed into a fresh install's `settings.json`
 * `mcp.servers` block. Behaves as an "opt-out" default — after the
 * first launch, each entry here behaves like any other settings.json
 * MCP server: editable, removable, and disabling sticks.
 *
 * Each entry is seeded at most once per install per name (see
 * `seededDefaultMcpServerNames` in DesktopSettings). Removing an entry
 * after first launch does NOT cause it to be re-seeded, so the user's
 * intent is respected.
 *
 * To add a new default in a future release: append a new entry here.
 * Existing installs will pick it up on the next launch as long as the
 * name isn't already in `seededDefaultMcpServerNames`.
 */
export const DEFAULT_MCP_SERVERS: ReadonlyArray<McpServerConfig> = [
  {
    name: `playwright`,
    transport: `stdio`,
    command: `npx`,
    args: [`-y`, `@playwright/mcp`],
  },
]

/**
 * Seed any `DEFAULT_MCP_SERVERS` entries that haven't been considered
 * yet for this install. Returns true iff `settings` was mutated (so the
 * caller knows to persist).
 *
 * Skips defaults whose name is already in `settings.mcp.servers` (the
 * user may have hand-added that name before this feature shipped — we
 * don't overwrite). The name is still recorded as seeded so we won't
 * try again on the next launch.
 */
export function seedDefaultMcpServers(settings: DesktopSettings): boolean {
  const seeded = new Set(settings.seededDefaultMcpServerNames ?? [])
  let mutated = false
  for (const cfg of DEFAULT_MCP_SERVERS) {
    if (seeded.has(cfg.name)) continue
    const existing = (settings.mcp?.servers ?? []).some(
      (s) => s.name === cfg.name
    )
    if (!existing) {
      upsertMcpServerInSettings(settings, cfg)
    }
    seeded.add(cfg.name)
    mutated = true
  }
  if (mutated) {
    settings.seededDefaultMcpServerNames = [...seeded].sort()
  }
  return mutated
}
