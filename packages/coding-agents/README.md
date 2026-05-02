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

## Cross-kind resume and forking

Two operations let you change which CLI drives a coding-agent:

### Convert (in-place)

Send a `convert-kind` inbox message:

```ts
await ctx.send(`/coding-agent/foo`, { kind: `codex` }, { type: `convert-kind` })
```

The agent's events history is preserved. The next prompt runs under the new kind.

### Fork (sibling agent)

Spawn with `from`:

```ts
await ctx.spawnCodingAgent({
  id: nanoid(10),
  kind: `codex`,
  workspace: { type: `volume` },
  from: { agentId: `/coding-agent/source`, workspaceMode: `clone` },
})
```

`workspaceMode` defaults: `share` for bind-mount sources, `clone` for volume sources (errors at spawn time if the provider doesn't implement `cloneWorkspace`).

### Provider capability matrix

| Provider              | `cloneWorkspace`     |
| --------------------- | -------------------- |
| `LocalDockerProvider` | yes (alpine cp -a)   |
| `HostProvider`        | no (bind-mount only) |

### Lossy aspects

- Cross-agent tool calls degrade to `Bash`-with-description per the protocol's `denormalize` rules.
- Mid-turn-crash artefacts (dangling `tool_call` events) are passed through as-is; a sanitisation pass is a documented follow-up.
