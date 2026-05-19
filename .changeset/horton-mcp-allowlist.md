---
'@electric-ax/agents': patch
'@electric-ax/agents-desktop': patch
---

Horton no longer auto-exposes every registered MCP server's tools. `registerHorton`, `createBuiltinAgentHandler`, and `BuiltinAgentsServer` now require an `mcpAllowlist` field of type `'*' | ReadonlyArray<string>`:

- `'*'` — every currently-registered MCP server (the previous default, now explicit-unsafe).
- `[]` — disable MCP tools entirely.
- `['server-a', 'server-b']` — restrict to the named servers.

**Breaking, TS-loud:** existing callers fail at compile time with a missing-property error and update one line. Pick `'*'` to keep current behavior, `[]` for the secure default, or an array for the considered choice.

The desktop app passes `'*'` because the user already explicitly configures which MCP servers to attach via the desktop settings UI; a per-server allowlist surfaced in the UI would be a separate change. The `electric-agents` CLI entrypoint reads `ELECTRIC_AGENTS_MCP_ALLOWLIST` (comma-separated, or `*`) and defaults to `[]` — operators must opt in explicitly.

`createAgentHandler(agentServerUrl, ...)` gains `mcpAllowlist` as its second positional argument.
