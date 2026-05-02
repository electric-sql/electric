# @electric-ax/coding-agents

Coding-agent runtime + sandbox providers for the agents-server platform.

## Internal: cross-stream reads

Fork (spawn-time inheritance) reads another agent's `events` via:

```ts
const handle = await ctx.observe({
  sourceType: 'entity',
  sourceRef: '/coding-agent/source-id',
})
const sourceEvents = (handle.db?.collections.events.toArray ??
  []) as Array<EventRow>
```

Caveats:

- Snapshot semantics: the read is at-spawn-time; subsequent source updates are not reflected.
- The handle includes a wake subscription by default (entities are observed). Fork callers do not need wake; the runtime garbage-collects un-awaited subscriptions per existing semantics.
