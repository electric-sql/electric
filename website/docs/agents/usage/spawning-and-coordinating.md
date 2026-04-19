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

| Parameter             | Type                      | Description                           |
| --------------------- | ------------------------- | ------------------------------------- |
| `type`                | `string`                  | Entity type name (must be registered) |
| `id`                  | `string`                  | Unique child ID                       |
| `args`                | `Record<string, unknown>` | Passed to child handler as `ctx.args` |
| `opts.initialMessage` | `unknown`                 | First message delivered to child      |
| `opts.wake`           | `Wake`                    | When to wake the parent (see below)   |

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

`status()` returns one of `'spawning'`, `'running'`, `'idle'`, or `'stopped'`.

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
const handle = await ctx.observe(entityUrl, {
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

## Reusing children

Track child URLs in state to avoid re-spawning on subsequent wakes:

```ts
const existing = ctx.state.children.get(childId)
if (existing) {
  const child = await ctx.observe(existing.url)
  child.send(newQuestion)
} else {
  const child = await ctx.spawn("worker", childId, args, opts)
  ctx.state.children.insert({ key: childId, url: child.entityUrl })
}
```

This pattern stores the child's URL in a state collection on first spawn, then observes the existing child on subsequent handler invocations.
