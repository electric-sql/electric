---
title: EntityHandle
titleTemplate: "... - Electric Agents"
description: >-
  API reference for EntityHandle returned by spawn and observe: streams, status, text retrieval, and messaging.
outline: [2, 3]
---

# EntityHandle

Handle returned by `ctx.spawn()` and `ctx.observe()`. Provides access to a child or observed entity's stream and status.

**Source:** `@durable-streams/darix-runtime`

```ts
interface EntityHandle {
  entityUrl: string
  type?: string
  db: EntityStreamDB
  events: ChangeEvent[]
  run: Promise<void>
  text(): Promise<string[]>
  send(msg: unknown): void
  status(): ChildStatus | undefined
}
```

## Members

| Member      | Type                       | Description                                                                         |
| ----------- | -------------------------- | ----------------------------------------------------------------------------------- |
| `entityUrl` | `string`                   | URL path of the entity (e.g. `"/chat/my-child"`).                                   |
| `type`      | `string \| undefined`      | Entity type name, if known.                                                         |
| `db`        | `EntityStreamDB`           | The entity's TanStack DB instance for querying its collections.                     |
| `events`    | `ChangeEvent[]`            | All change events received from this entity's stream.                               |
| `run`       | `Promise<void>`            | Promise that resolves when the entity's current run completes. Useful with `await`. |
| `text()`    | `Promise<string[]>`        | Returns all text outputs from the entity's stream.                                  |
| `send(msg)` | `void`                     | Send a message to this entity.                                                      |
| `status()`  | `ChildStatus \| undefined` | Current status of the entity, or `undefined` if unknown.                            |

## ChildStatus

```ts
type ChildStatus = ChildStatusEntry
```

```ts
interface ChildStatusEntry {
  key: string
  entity_url: string
  entity_type: string
  status: "spawning" | "running" | "idle" | "stopped"
}
```

Status values:

| Status     | Description                                                 |
| ---------- | ----------------------------------------------------------- |
| `spawning` | Entity creation is in progress.                             |
| `running`  | Handler is currently executing.                             |
| `idle`     | Handler has completed; entity is waiting for the next wake. |
| `stopped`  | Entity has been stopped or deleted.                         |
