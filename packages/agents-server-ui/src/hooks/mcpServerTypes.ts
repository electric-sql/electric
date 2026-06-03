// Shape of a server row broadcast from the Electron main process. Mirrors
// `agents-mcp/src/registry.ts`'s `ListedEntry` plus desktop-only fields
// (provenance + shadowing) computed from settings.json + workspace mcp.json.
// Defined in the UI package so renderers don't pull a Node-only dep.

export type McpStatus =
  | `connecting`
  | `authenticating`
  | `ready`
  | `error`
  | `disabled`
  /**
   * Synthetic state: a settings.json entry whose name is also defined
   * in the workspace mcp.json — workspace wins, the settings copy is
   * not running. Rendered grayed out next to the workspace twin.
   */
  | `shadowed`

/** Where the entry originated. Drives per-row Edit/Remove gating in the UI. */
export type McpProvenance = `settings` | `workspace` | `extras`

export interface McpServerRow {
  name: string
  transport?: `http` | `stdio`
  url?: string
  authMode?: string
  status: McpStatus
  authUrl?: string
  error?: { kind: string; message: string }
  toolCount: number
  tools?: Array<{ name: string; description?: string }>
  /** Where this entry came from. */
  provenance: McpProvenance
  /** True iff a settings.json entry is overridden by a workspace mcp.json one. */
  shadowed: boolean
  /**
   * Original config blob — present only for `provenance === 'settings'`
   * rows so the Edit form can pre-fill from the source-of-truth, not
   * the registry's runtime view (which doesn't carry url/command/auth).
   */
  config?: {
    name: string
    transport: `http` | `stdio`
    [key: string]: unknown
  }
}
