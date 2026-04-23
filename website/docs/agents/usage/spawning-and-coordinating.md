---
title: Spawning & coordinating
titleTemplate: "... - Electric Agents"
description: >-
  Spawn child entities, observe existing ones, send messages, and use EntityHandle for coordination.
outline: [2, 3]
---

# Spawning & coordinating

Entities coordinate by spawning children, observing other entities, and sending messages.

## spawn

Create a child entity:

```ts
const child = await ctx.spawn(type, id, args?, opts?)
```

| Parameter             | Type                      | Description                            |
| --------------------- | ------------------------- | -------------------------------------- |
| `type`                | `string`                  | Entity type name (must be registered)  |
| `id`                  | `string`                  | Unique child ID                        |
| `args`                | `Record<string, unknown>` | Passed to child handler as `ctx.args`  |
| `opts.initialMessage` | `unknown`                 | First message delivered to child       |
| `opts.wake`           | `Wake`                    | When to wake the parent (see below)    |
| `opts.tags`           | `Record<string, string>`  | Key-value tags applied to the child    |
| `opts.observe`        | `boolean`                 | Also observe the child (default: true) |

`spawn` is a creation-only operation. Calling it with a `(type, id)` pair that already exists in the entity's manifest throws an error. Use `observe(entity(url))` to get a handle to an existing child.

The `wake` option controls when the parent's handler is re-invoked:

- `'runFinished'` — wake when the child's agent run completes. The child's text response is included in the wake event by default.
- `{ on: 'runFinished', includeResponse?: boolean }` — same as above, but set `includeResponse: false` to omit the child's text response from the wake event.
- `{ on: 'change', collections?: string[], debounceMs?: number, timeoutMs?: number }` — wake when specified collections change.

Returns an [`EntityHandle`](#entityhandle).

## EntityHandle

Returned by `spawn` and `observe`:

```ts
interface EntityHandle {
  entityUrl: string
  type?: string
  db: EntityStreamDB // Read-only TanStack DB
  events: ChangeEvent[]
  run: Promise<void> // Resolves when child's run completes
  text(): Promise<string[]> // Get completed text outputs
  send(msg: unknown): void // Send follow-up message
  status(): ChildStatus | undefined
}
```

`status()` returns a `ChildStatus` object (or `undefined` if no status is known yet) with `.status`, `.entity_url`, `.entity_type`, and `.key`.

## Waiting for children

Wait for a single child:

```ts
await child.run
const output = (await child.text()).join("\n\n")
```

Wait for multiple children in parallel:

```ts
const results = await Promise.all(
  children.map(async ({ handle }) => ({
    text: (await handle.text()).join("\n\n"),
  }))
)
```

## observe

Subscribe to an existing entity without spawning it:

```ts
const handle = await ctx.observe(entity(entityUrl), {
  wake: { on: "change", collections: ["runs", "childStatus"] },
})
```

Returns an `EntityHandle`. Use `wake` to re-invoke the parent handler when the observed entity changes.

## send

Fire-and-forget message to another entity:

```ts
ctx.send("/assistant/target-id", { text: "Hello" })
ctx.send("/assistant/target-id", payload, { type: "custom_type" })
```

Messages appear in the target entity's `inbox` collection.

## sleep

Return the entity to idle state, ending the current handler invocation:

```ts
ctx.sleep()
```

The entity remains alive and can be woken again by incoming messages or observed changes.

## Working with existing children

After spawning children in `firstWake`, use `observe` on subsequent wakes to get handles:

```ts
async handler(ctx) {
  if (ctx.firstWake) {
    await ctx.spawn("worker", "analyst", { systemPrompt: "..." }, {
      initialMessage: "Initial task.",
      wake: "runFinished",
    })
  }

  const analyst = await ctx.observe(entity("/worker/analyst"))

  if (wake.type === "message_received") {
    analyst.send(wake.payload)
  }
}
```

`spawn` creates the child once. `observe` returns a handle on every wake — it's how you interact with children after creation.

## Workers and authenticated APIs

Workers are least-privilege sandboxes — they receive a `systemPrompt`, `tools`, and `initialMessage`, nothing else. Never interpolate secrets (`process.env.API_KEY`, auth tokens) into a worker's prompt or message — they are persisted in the entity's durable stream.

**Manager-side prefetch** is the recommended pattern: the manager does the authenticated fetch and passes the raw data to the worker.

```ts
// In the manager's tool:
const response = await fetch(apiUrl, {
  headers: { Authorization: `Bearer ${process.env.API_KEY}` },
})
const data = await response.json()

// Pass data, not credentials, to the worker
await ctx.spawn(
  "worker",
  id,
  { systemPrompt: "Summarise this data." },
  {
    initialMessage: JSON.stringify(data),
    wake: "runFinished",
  }
)
```

When the worker needs to make follow-up authenticated calls (pagination, conditional fetches), register a custom worker entity type in your app that closes over the credential at registration time — don't use the built-in `worker` type for this.
