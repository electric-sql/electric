---
'@electric-ax/agents-mcp': minor
'@electric-ax/agents': minor
'@electric-ax/agents-desktop': minor
'@electric-ax/agents-server-ui': minor
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
---

Add Model Context Protocol (MCP) support — agents can call tools, read resources, and use prompts from external MCP servers (stdio + Streamable HTTP), with OAuth handled by the runtime. New `@electric-ax/agents-mcp` package ships the `Registry` API, transports, OAuth bridges, and opt-in `keychainPersistence` / `filePersistence` helpers. The Electron desktop app exposes a Settings → MCP Servers page and a `mcp.servers` block in `settings.json` that layers with the per-workspace `mcp.json`. Built-in `horton` and `worker` agents see registered MCP tools transparently via `mcp.tools()`.
