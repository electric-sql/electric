---
'@electric-ax/agents-desktop': patch
'@electric-ax/agents-server-ui': patch
---

Add `ELECTRIC_DESKTOP_PRINCIPAL` env var for local development without auth. The desktop app injects the `electric-principal` header on all requests to the agents-server, enabling pull-wake runner registration and message sends to work locally. Also fix the UI to derive the optimistic message sender from the configured principal and stop sending the redundant `from` field in API requests.
