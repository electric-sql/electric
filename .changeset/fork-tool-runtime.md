---
'@electric-ax/agents-runtime': patch
---

Add `ctx.fork(targetEntityUrl?, opts?)` to `HandlerContext`. Calls the agents-server fork endpoint with `anchor: 'latest_completed_run'` to create a sibling session that inherits the source's history up to the most recent completed run. Defaults `targetEntityUrl` to `ctx.entityUrl` (self-fork). Auto-observes the new fork with `wake: { on: 'runFinished', includeResponse: true }` so the caller wakes when the fork's next run finishes; pass `observe: false` for fire-and-forget. Wired through `RuntimeServerClient.forkEntity` and a new `WiringConfig.forkEntity` injection point alongside `createOrGetChild`.
