// Shape of a server row in the MCP registry's snapshot, mirrored from
// `agents-mcp/src/registry.ts`'s `ListedEntry`. Defined in the UI
// package so renderers don't pull in a Node-only dep transitively.

export type McpStatus =
  | `connecting`
  | `authenticating`
  | `ready`
  | `error`
  | `disabled`

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
}
