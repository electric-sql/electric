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

| Parameter                 | Type                      | Description                            |
| ------------------------- | ------------------------- | -------------------------------------- |
| `type`                    | `string`                  | Entity type name (must be registered)  |
| `id`                      | `string`                  | Unique child ID                        |
| `args`                    | `Record<string, unknown>` | Passed to child handler as `ctx.args`  |
| `opts.initialMessage`     | `unknown`                 | First message delivered to child       |
| `opts.initialMessageType` | `string`                  | Optional inbox message type for `initialMessage` |
| `opts.wake`               | `Wake`                    | When to wake the parent (see below)    |
| `opts.tags`               | `Record<string, string>`  | Key-value tags applied to the child    |
| `opts.observe`            | `boolean`                 | Also observe the child (default: true) |
| `opts.sandbox`            | `SpawnSandboxOption`      | Sandbox profile or inheritance for the child |

`spawn` is a creation-only operation. Calling it with a `(type, id)` pair that already exists in the entity's manifest throws an error. Use `observe(entity(url))` to get a handle to an existing child.

The `wake` option controls when the parent's handler is re-invoked:

- `'runFinished'` — wake when the child's agent run completes. The child's text response is included in the wake event by default.
- `{ on: 'runFinished', includeResponse?: boolean }` — same as above, but set `includeResponse: false` to omit the child's text response from the wake event.
- `{ on: 'change', collections?: string[], debounceMs?: number, timeoutMs?: number }` — wake when specified collections change.

Returns an [`EntityHandle`](#entityhandle).

Use [Sandboxing](./sandboxing) when children need isolated filesystem, process, or network access, or when a worker should inherit its parent's sandbox.

## fork

Forking creates a new entity from another entity's history at its latest completed run. Use it when you want to branch a session and try a different continuation:

```ts
const fork = await ctx.forkSelf("variant-a", {
  initialMessage: { text: "Explore the risky option instead." },
  tags: { branch: "variant-a" },
})
```

`ctx.fork(sourceEntityUrl, id, opts?)` forks another entity; `ctx.forkSelf(id, opts?)` forks the current entity. The new fork is a child of the forking entity by default and registers a `runFinished` wake with `includeResponse: true`, so the parent wakes when the fork's next run finishes. Options mirror `spawn` where they apply: `initialMessage`, `wake`, `tags`, and `observe`.

Pass `observe: false` for fire-and-forget branching with no parent relationship or wake subscription.

## EntityHandle

Returned by `spawn` and `observe`:

```ts
interface EntityHandle {
  entityUrl: string
  type?: string
  db: EntityStreamDB // TanStack DB for the observed entity stream
  events: ChangeEvent[]
  send(msg: unknown): Promise<SendResult> // Send follow-up message
  status(): ChildStatus | undefined
}
```

`status()` returns a `ChildStatus` object (or `undefined` if no status is known yet) with `.status`, `.entity_url`, `.entity_type`, and `.key`.

## Continuing after children finish

Do not wait for child output inside the same wake. Instead, spawn or observe the child with a wake condition, persist enough metadata to correlate the child, and return.

```ts
async handler(ctx, wake) {
  if (ctx.firstWake) {
    const child = await ctx.spawn(
      "worker",
      "analyst",
      { systemPrompt: "Analyze this input", tools: ["read"] },
      {
        initialMessage: "Initial task.",
        wake: { on: "runFinished", includeResponse: true },
      }
    )

    ctx.state.children.insert({
      key: "analyst",
      url: child.entityUrl,
      status: "running",
    })
    return
  }

  const finished = wake.payload?.finished_child
  if (finished) {
    ctx.state.children.update(finished.url, (draft) => {
      draft.status = finished.run_status
      draft.response = finished.response ?? ""
    })
  }
}
```

Use `includeResponse: true` for simple text handoff. For structured or large outputs, have children write to shared state and use the `runFinished` wake as the continuation signal.

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
    await ctx.spawn(
      "worker",
      "analyst",
      { systemPrompt: "...", tools: ["read"] },
      {
        initialMessage: "Initial task.",
        wake: { on: "runFinished", includeResponse: true },
      }
    )
  }

  const analyst = await ctx.observe(entity("/worker/analyst"))

  if (wake.type === "inbox") {
    analyst.send(wake.payload)
  }
}
```

`spawn` creates the child once. `observe` returns a handle on every wake — it's how you interact with children after creation.

## Workers and authenticated APIs

Workers are least-privilege sandboxes. The built-in `worker` receives a `systemPrompt`, a selected `tools` subset, an optional `sharedDb` config, and the `initialMessage` delivered at spawn time. Never interpolate secrets (`process.env.API_KEY`, auth tokens) into a worker's prompt or message — they are persisted in the entity's durable stream.

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
  { systemPrompt: "Summarise this data.", tools: ["read"] },
  {
    initialMessage: JSON.stringify(data),
    wake: { on: "runFinished", includeResponse: true },
  }
)
```

When the worker needs to make follow-up authenticated calls (pagination, conditional fetches), register a custom worker entity type in your app that closes over the credential at registration time — don't use the built-in `worker` type for this.
