---
title: WakeEvent
titleTemplate: '... - Electric Agents'
description: >-
  Type reference for WakeEvent and Wake configuration: runFinished and change-based wake conditions.
outline: [2, 3]
---

# WakeEvent

Describes why an entity handler was invoked. Passed as the second argument to the handler function.

**Source:** `@electric-ax/agents-runtime`

```ts
type WakeEvent = {
  source: string
  type: string
  fromOffset: number
  toOffset: number
  eventCount: number
  payload?: unknown
  summary?: string
  fullRef?: string
}
```

## Fields

| Field        | Type      | Description                                                                                                                      |
| ------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `source`     | `string`  | URL or identifier of the stream that triggered the wake.                                                                         |
| `type`       | `string`  | Wake type. Usually `"message_received"` or `"wake"`; fallback webhook events can use `triggerEvent` or `"message"`. See catalog. |
| `fromOffset` | `number`  | Start offset of new events in the source stream.                                                                                 |
| `toOffset`   | `number`  | End offset (exclusive) of new events.                                                                                            |
| `eventCount` | `number`  | Number of new events in this wake.                                                                                               |
| `payload`    | `unknown` | Optional payload data associated with the wake. Shape depends on `type`.                                                         |
| `summary`    | `string`  | Optional human-readable summary of the wake reason.                                                                              |
| `fullRef`    | `string`  | Optional full reference identifier for the wake source.                                                                          |

## Wake-type catalog

Handlers usually see two values for `wake.type`. Direct inbox messages arrive as `"message_received"`. Most non-message triggers are flattened into `"wake"`, with the specifics carried on `wake.payload`. Low-level webhook fallbacks can surface `triggerEvent` directly, or `"message"` when no trigger event is provided.

### `"message_received"`

An external message landed in the entity's inbox — from `ctx.send()`, the CLI's `electric agents send`, or any direct `/send` HTTP call.

| Field          | Shape                                                                             |
| -------------- | --------------------------------------------------------------------------------- |
| `wake.source`  | The `from` field of the message (sender identifier), or the entity URL if absent. |
| `wake.payload` | The message payload (any JSON-serialisable value).                                |
| `wake.summary` | The `message_type` if the sender set one.                                         |

### `"wake"`

A synthesised wake for any non-message trigger. `wake.payload` is a `WakeMessage`:

```ts
type WakeMessage = {
  timestamp: string
  source: string
  timeout: boolean
  changes: Array<{
    collection: string
    kind: 'insert' | 'update' | 'delete'
    key: string
  }>
  finished_child?: {
    url: string
    type: string
    run_status: 'completed' | 'failed'
    response?: string
    error?: string
  }
  other_children?: Array<{
    url: string
    type: string
    status: 'spawning' | 'running' | 'idle' | 'stopped'
  }>
}
```

Inspect the payload to distinguish the sub-kind:

| Sub-kind            | Producer                                                                    | Payload marker                                                                            |
| ------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Child finished      | `ctx.spawn(..., { wake: 'runFinished' })` when the child completes or fails | `payload.finished_child` is set (with `run_status` and optional `response`)               |
| Observed change     | `ctx.observe(..., { wake: { on: 'change' } })` or `observe(db(...))`        | `payload.changes` is non-empty                                                            |
| Shared-state change | `await ctx.observe(db(...), { wake: { on: 'change' } })`                    | `payload.changes` is non-empty, `payload.source` identifies the shared-state stream       |
| Cron fired          | A cron schedule entry on the entity's manifest                              | `payload.source` identifies the schedule; `payload.changes` is empty                      |
| Scheduled send      | A `future_send` schedule fires                                              | Arrives as `"message_received"` (not `"wake"`) — the schedule produces a message delivery |
| Timeout             | `timeoutMs` on a `change` wake config elapsed with no changes               | `payload.timeout === true`, `payload.changes` is empty                                    |

For the narrative on how these are produced, see [Waking entities](../usage/waking-entities).

## Wake

The `Wake` type configures when a parent should be woken in response to a child, observed entity, or shared state change. Used in `ctx.spawn()`, `ctx.observe()`, and `ctx.observe(db(...))` options.

```ts
type Wake =
  | 'runFinished'
  | { on: 'runFinished'; includeResponse?: boolean }
  | {
      on: 'change'
      collections?: string[]
      ops?: ('insert' | 'update' | 'delete')[]
      debounceMs?: number
      timeoutMs?: number
    }
```

### `'runFinished'`

Wake the parent when the child's agent run completes (status changes to `completed` or `failed`). By default, the wake event includes the child's concatenated text response in `finished_child.response`.

### `{ on: 'runFinished', includeResponse?: boolean }`

Object form of `runFinished` with options. Set `includeResponse: false` to omit the child's text response from the wake event.

### `{ on: 'change' }`

Wake the parent when changes occur in the observed stream.

| Field         | Type       | Description                                                           |
| ------------- | ---------- | --------------------------------------------------------------------- |
| `on`          | `'change'` | Required discriminant.                                                |
| `collections` | `string[]` | Optional filter. Only wake on changes to these collections.           |
| `ops`         | `string[]` | Optional operation filter: `"insert"`, `"update"`, and/or `"delete"`. |
| `debounceMs`  | `number`   | Debounce interval in milliseconds. Batches rapid changes.             |
| `timeoutMs`   | `number`   | Maximum time to wait before waking, even if no changes occur.         |
