---
title: Waking entities
titleTemplate: "... - Electric Agents"
description: >-
  How entity handlers get invoked - the triggers that produce wakes, how wake config threads through spawn/observe/observe(db(...)), and how to read a WakeEvent in a handler.
outline: [2, 3]
---

# Waking entities

Entities in Electric Agents are driven by **wakes**. A wake is a single handler invocation triggered by something outside the handler: a new message, a child finishing, a change in an observed stream, or a schedule. Between wakes the entity is idle — no process, no memory, no running handler.

Everything you do to make an entity respond to something — `ctx.spawn(..., { wake })`, `ctx.observe(..., { wake })`, `ctx.send()`, `upsertCronSchedule()` — is ultimately a way to produce a wake.

## The mental model

```
external event  ─►  wake entry (persisted)  ─►  handler invocation  ─►  WakeEvent passed to handler
```

1. **External event.** A message arrives, a child transitions, a watched collection changes, a cron fires.
2. **Wake entry is persisted** to the entity's stream. This is the durability guarantee — wakes survive process restarts, network blips, and crashes. A wake that was written will eventually be delivered to a handler.
3. **Handler is invoked.** The runtime picks up the wake, loads the entity's state, and calls your handler with a `WakeEvent` describing what triggered this invocation.
4. **Handler runs.** You read `ctx.events`, inspect `wake`, configure the agent, emit new events. When the handler returns (or calls `ctx.sleep()`), the entity goes idle until the next wake.

This means handlers are re-entrant: the same handler function is called fresh on every wake. Use `ctx.firstWake` for one-time initialization, and `ctx.db.actions` / `ctx.db.collections` to carry state across wakes.

## What produces a wake

There are five things that can wake an entity:

### 1. An incoming message

Any external `/send` (via the CLI, HTTP, or another entity's `ctx.send()`) appends a `message_received` event to the entity's stream, which wakes the handler:

```ts
ctx.send("/assistant/peer", { text: "hello" })
```

The receiving handler sees `wake.type === "message_received"` and finds the payload on `wake.payload`.

### 2. A spawned child

Pass `wake` when spawning a child to control when the parent wakes:

```ts
const child = await ctx.spawn(
  "worker",
  "analysis-1",
  { systemPrompt: "Analyse this input.", tools: ["read"] },
  {
    initialMessage: "begin",
    wake: { on: "runFinished", includeResponse: true },
  }
)
```

See the full catalog of `Wake` values in [WakeEvent](../reference/wake-event#wake).

### 3. An observed entity

`ctx.observe()` subscribes to another entity's stream without spawning it. Pair it with a `wake` option to re-invoke this handler when the observed stream changes:

```ts
import { entity } from "@electric-ax/agents-runtime"

await ctx.observe(entity(someEntityUrl), {
  wake: { on: "change", collections: ["status"], debounceMs: 250 },
})
```

The `entity()` helper wraps a raw URL string into the correct observe target type.

### 4. Shared state

`observe(db(...))` connects to a shared-state stream and, with `wake`, re-wakes the connecting entity when its collections change:

```ts
await ctx.observe(db("board-1", schema), {
  wake: { on: "change", collections: ["findings"] },
})
```

### 5. A schedule

Runtime hosts can expose schedule-management tools through `ctx.electricTools`. The current schedule tool set is `list_schedules`, `upsert_cron_schedule`, `upsert_future_send`, and `delete_schedule`. Schedule entries live on the entity's manifest, so they survive restarts and can be updated or cancelled idempotently.

## Reading a WakeEvent

Your handler signature is:

```ts
handler(ctx: HandlerContext, wake: WakeEvent) => void | Promise<void>
```

The minimum useful pattern is to branch on `wake.type`:

```ts
async handler(ctx, wake) {
  if (wake.type === "message_received") {
    // external input - reply, dispatch, etc.
    ctx.useAgent({ ... })
    await ctx.agent.run()
    return
  }

  // everything else (child finished, change, cron, timeout) arrives as type "wake".
  // Inspect wake.payload for the specific sub-kind.
  ctx.sleep()
}
```

Two wake types reach handlers directly:

- `"message_received"` — an external message was delivered to this entity's inbox.
- `"wake"` — a synthesised wake for anything else (child finished, collection change, cron, timeout). The specifics are on `wake.payload`. A future-send schedule delivers a message, so it arrives as `"message_received"`.

For the full payload shape (`changes[]`, `finished_child`, `other_children`, `timeout`), see the [wake-type catalog](../reference/wake-event#wake-type-catalog) in the reference.

## Coalescing and idempotency

Multiple external events that arrive while an entity is busy (or between acks) are coalesced into a single wake. The runtime guarantees that:

- A wake covers a contiguous range of offsets in the source stream (`wake.fromOffset`..`wake.toOffset`).
- `wake.eventCount` tells you how many new events this wake represents.
- Handlers must be safe to re-run with the same input — at-least-once delivery. Use `ctx.firstWake` and idempotent writes to collections rather than side effects on each wake.

If you need to deduplicate explicitly, key your writes by something stable (the child's entity URL, the message's producer/epoch/seq headers, etc.) and let the collection's primary key do the dedup.

## Debounce and timeouts on `change` wakes

`{ on: 'change' }` has two knobs worth understanding:

- `debounceMs` — if set, rapid-fire changes are batched; the wake fires `debounceMs` after the last change.
- `timeoutMs` — if set, the wake fires after this interval **even if nothing changed**. Useful for heartbeat-style handlers that need to periodically check state without requiring external events.

Both are optional. If neither is set, every change produces a wake.

## Sleeping between wakes

When the handler finishes (or calls `ctx.sleep()`), the entity returns to idle. The runtime persists the ack offset so the next wake starts from the right place. You don't have to — and shouldn't — hold resources across wakes.

## See also

- [WakeEvent](../reference/wake-event) — full type reference and wake-type catalog.
- [Spawning & coordinating](./spawning-and-coordinating) — using `wake` with `spawn` and `observe`.
- [Shared state](./shared-state) — using `wake` with `observe(db(...))`.
- [Writing handlers](./writing-handlers) — `HandlerContext` and `firstWake` patterns.
