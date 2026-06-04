---
'@electric-ax/agents-runtime': patch
---

Add `ctx.fork(targetEntityUrl?)` to `HandlerContext`. Calls the agents-server fork endpoint with `anchor: 'latest_completed_run'`, `parent: ctx.entityUrl`, and a `runFinished + includeResponse` wake — so the new fork is a CHILD of this entity (same parent-ownership model as `ctx.spawn`) and reports back via the same manifest-anchored wake mechanism `spawn` uses. Defaults `targetEntityUrl` to `ctx.entityUrl` for self-fork.

Internally writes a `kind: 'child'` manifest row on the parent's `main` stream alongside the server-side wake registration, mirroring the spawn flow's bookkeeping so the relationship persists across wakes. Wired through new `parent` + `wake` fields on `RuntimeServerClient.forkEntity` and `WiringConfig.forkEntity`.

The `send` tool's `payload` description now documents the canonical `{ text: "..." }` shape for chat-rendered targets (Horton sessions, agent forks) so messages emitted by `send` render as chat bubbles instead of blank bars.
