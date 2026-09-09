---
'@electric-ax/agents-runtime': patch
'@electric-ax/agents-server': patch
---

Adopt backend-issued claim write tokens: when the Durable Streams backend implements the Write Fencing extension, the Agents Server adopts the `write_token` it delivers with wake notifications, pull claims, and heartbeat acks as the claim's write token, and the runtime refreshes its token from heartbeat responses. An opt-in `fencedSessionStreams` server option (env `ELECTRIC_AGENTS_FENCED_SESSION_STREAMS`) creates entity session streams with `Write-Fence: true` and forwards the token plus the fenced-class assertion on runtime appends, so the backend itself is the write authority and rejects deposed or lapsed writers — including across a server restart or from another server instance, where the in-memory token store would not know the claim. In this mode a session-stream create or fork fails unless the backend echoes `Write-Fence: true`, so the option never yields silently unfenced streams. Off by default, and behaviour is unchanged when the backend supplies no token.
