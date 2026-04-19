---
title: WakeEvent
titleTemplate: "... - Electric Agents"
description: >-
  Type reference for WakeEvent and Wake configuration: runFinished and change-based wake conditions.
outline: [2, 3]
---

# WakeEvent

Describes why an entity handler was invoked. Passed as the second argument to the handler function.

**Source:** `@durable-streams/darix-runtime`

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

| Field        | Type      | Description                                                          |
| ------------ | --------- | -------------------------------------------------------------------- |
| `source`     | `string`  | URL or identifier of the stream that triggered the wake.             |
| `type`       | `string`  | Wake type (e.g. `"message_received"`, `"child_status"`, `"change"`). |
| `fromOffset` | `number`  | Start offset of new events in the source stream.                     |
| `toOffset`   | `number`  | End offset (exclusive) of new events.                                |
| `eventCount` | `number`  | Number of new events in this wake.                                   |
| `payload`    | `unknown` | Optional payload data associated with the wake.                      |
| `summary`    | `string`  | Optional human-readable summary of the wake reason.                  |
| `fullRef`    | `string`  | Optional full reference identifier for the wake source.              |

## Wake

The `Wake` type configures when a parent should be woken in response to a child, observed entity, or shared state change. Used in `ctx.spawn()`, `ctx.observe()`, and `ctx.connectSharedState()` options.

```ts
type Wake =
  | "runFinished"
  | { on: "runFinished"; includeResponse?: boolean }
  | {
      on: "change"
      collections?: string[]
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

| Field         | Type       | Description                                                   |
| ------------- | ---------- | ------------------------------------------------------------- |
| `on`          | `'change'` | Required discriminant.                                        |
| `collections` | `string[]` | Optional filter. Only wake on changes to these collections.   |
| `debounceMs`  | `number`   | Debounce interval in milliseconds. Batches rapid changes.     |
| `timeoutMs`   | `number`   | Maximum time to wait before waking, even if no changes occur. |
