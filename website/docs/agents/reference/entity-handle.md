---
title: EntityHandle
titleTemplate: "... - Electric Agents"
description: >-
  API reference for EntityHandle returned by spawn and observe: streams, status, and messaging.
outline: [2, 3]
---

# EntityHandle

Handle returned by `ctx.spawn()` and `ctx.observe(entity(...))`. It identifies a child or observed entity and exposes its materialized stream.

**Source:** `@electric-ax/agents-runtime`

```ts
interface EntityHandle {
  sourceType: string
  sourceRef: string
  streamUrl?: string
  entityUrl: string
  type?: string
  db: EntityStreamDB
  events: ChangeEvent[]
  send(msg: unknown): Promise<SendResult>
  status(): ChildStatus | undefined
}
```

## Members

| Member      | Type                       | Description                                                     |
| ----------- | -------------------------- | --------------------------------------------------------------- |
| `sourceType` | `string`                  | Observation source type inherited from `ObservationHandle`.     |
| `sourceRef` | `string`                   | Stable source reference inherited from `ObservationHandle`.     |
| `streamUrl` | `string \| undefined`      | Source stream URL when available.                               |
| `entityUrl` | `string`                   | URL path of the entity, e.g. `"/worker/child-1"`.              |
| `type`      | `string \| undefined`      | Entity type name, if known.                                     |
| `db`        | `EntityStreamDB`           | The entity's TanStack DB instance for querying its collections. |
| `events`    | `ChangeEvent[]`            | Change events received from this entity's stream this wake.     |
| `send(msg)` | `Promise<SendResult>`      | Send a follow-up message to this entity.                        |
| `status()`  | `ChildStatus \| undefined` | Current child status, or `undefined` if unknown.                |

## Coordinating with completion

`EntityHandle` does **not** provide a same-wake “wait for output” API. To continue after a child finishes, spawn or observe it with a wake condition and return from the current handler:

```ts
const child = await ctx.spawn(
  "worker",
  "analyst-1",
  { systemPrompt: "Analyze this input", tools: ["read"] },
  {
    initialMessage: "...",
    wake: { on: "runFinished", includeResponse: true },
  }
)

ctx.state.children.insert({
  key: child.entityUrl,
  url: child.entityUrl,
  status: "running",
})
return
```

On the later wake, inspect the finished child payload and continue orchestration:

```ts
if (wake.payload?.finished_child) {
  const finished = wake.payload.finished_child
  const response = finished.response ?? ""

  ctx.state.children.update(finished.url, (draft) => {
    draft.status = finished.run_status
    draft.response = response
  })
}
```

For structured or large outputs, have the child write to shared state and use the `runFinished` wake as the signal that it is safe to read/reduce that state.

## ChildStatus

```ts
type ChildStatus = ChildStatusEntry
```

```ts
interface ChildStatusEntry {
  key: string
  entity_url: string
  entity_type: string
  status: "spawning" | "running" | "idle" | "paused" | "stopping" | "stopped" | "killed"
}
```

Status values:

| Status     | Description                                                 |
| ---------- | ----------------------------------------------------------- |
| `spawning` | Entity creation is in progress.                             |
| `running`  | Handler is currently executing.                             |
| `idle`     | Handler has completed; entity is waiting for the next wake. |
| `paused`   | Entity is paused.                                           |
| `stopping` | Entity is stopping and rejects normal writes.                |
| `stopped`  | Entity has been stopped or deleted.                         |
| `killed`   | Entity was killed by a terminal lifecycle signal.            |
