---
'@electric-ax/agents-desktop': patch
---

Seed `@playwright/mcp` into the desktop's `settings.json mcp.servers`
block on first launch — gives every new install browser automation
out of the box. The default is opt-out friendly: after the seed runs,
the entry behaves like any other settings.json MCP server (Edit,
Remove, Disable all work normally), and removing it sticks across
restarts thanks to a per-name `seededDefaultMcpServerNames` flag.
Future built-in defaults can be added to `DEFAULT_MCP_SERVERS` in
`settings/mcp-defaults.ts`; existing installs will pick them up on
the next launch as long as the name isn't already recorded as seeded.
