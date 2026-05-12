---
"@electric-ax/agents-server": minor
"@electric-ax/agents-runtime": minor
"@electric-ax/agents": minor
"electric-ax": minor
"@electric-ax/agents-server-ui": patch
"@electric-ax/agents-desktop": patch
"@electric-ax/agents-mcp": patch
---

Port pull-wake runners onto the tenant-aware agents-server routing refactor.

Agents-server now supports runner registration, runner-owned pull-wake subscriptions, dispatch policy resolution, subscription stream linking, compact Durable Streams wake claims, callback-forward claim lifecycle handling, and claim-scoped write tokens. Runtime built-ins can register pull-wake runners, tail runner wake streams, claim work through the server, heartbeat offsets, and acknowledge completed work. The CLI, desktop integration, server UI, and local full-stack compose setup now use asserted identity and runner-backed local sessions for the pull-wake flow.

Saved agents-server connections can include additional request headers for tenant-aware deployments, and CLI/runtime URL handling now preserves base query parameters such as `?secret=...`.
