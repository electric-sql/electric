---
'@electric-ax/agents-runtime': patch
---

Add `ctx.fork(opts?)` to `HandlerContext`, with an opts shape that mirrors `ctx.spawn`'s where the semantics map:

```ts
ctx.fork(opts?: {
  targetEntityUrl?: string  // omit for self-fork
  initialMessage?: unknown  // server delivers to the fork in the same round-trip (not atomic with creation)
  wake?: Wake               // overrides the default runFinished + includeResponse
  tags?: Record<string, string>
  observe?: boolean         // `false` = fire-and-forget (no parent, no wake, no manifest entry)
})
```

By default (`observe: true`), the new fork is a CHILD of this entity (same parent-ownership model as `ctx.spawn`), and a `runFinished + includeResponse` wake is registered on it server-side. Reply delivery uses the same manifest-anchored wake mechanism `ctx.spawn` uses — when the fork's next run finishes, this entity wakes with the response. `observe: false` opts out of the parent relationship entirely: no parent URL, no wake subscription, no manifest entry on the parent's stream.

Internally writes a `kind: 'child'` manifest row on the parent's stream alongside the server-side wake registration, mirroring the spawn flow's bookkeeping so the relationship persists across wakes. Wired through new fields on `RuntimeServerClient.forkEntity` (`parent`, `wake`, `initialMessage`, `tags`) and `WiringConfig.forkEntity`. A `normalizeWake` helper translates the user-facing `Wake` type into the wakeRegistry-compatible shape, same logic `createOrGetChild` uses for spawn.

The `send` tool's `payload` description now documents the canonical `{ text: "..." }` shape for chat-rendered targets (Horton sessions, agent forks) so messages emitted by `send` render as chat bubbles instead of blank bars.
