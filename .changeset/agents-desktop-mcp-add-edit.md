---
'@electric-ax/agents-desktop': patch
'@electric-ax/agents-server-ui': patch
'@electric-ax/agents': patch
---

Add a form-based **Add / Edit / Remove** flow for MCP servers in the
desktop's Settings → MCP Servers page. Before this, the only way to
register a server was to hand-edit `settings.json` or a workspace
`mcp.json`. The dialog supports both `http` and `stdio` transports, all
four auth modes, and writes through to the global `settings.json
mcp.servers` block.

The MCP page also gains provenance + shadowing awareness:

- Entries from a workspace `mcp.json` render a "from mcp.json" badge
  and are read-only (no Edit/Remove). Lifecycle verbs still apply.
- When a name in `settings.json` collides with one in workspace
  `mcp.json`, the workspace still wins (existing rule); the shadowed
  settings entry is rendered grayed-out next to the running workspace
  twin so the user can see what's been overridden.

`BuiltinAgentsServer` gains a public `setExtraMcpServers(extras)` so
the desktop can push add/edit/remove changes to the live MCP registry
without restarting. Workspace `mcp.json` continues to win on name
collision through the same merge path used by the file watcher.
