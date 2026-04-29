---
title: Shared state
titleTemplate: "... - Electric Agents"
description: >-
  Coordinate across entities with shared state streams, schema definition, and cross-entity reads and writes.
outline: [2, 3]
---

# Shared state

Shared state allows multiple entities to read and write the same collections. A parent entity creates a shared state stream, and children connect to it.

## Schema definition

Define a `SharedStateSchemaMap` — a record of collection names to their schemas:

```ts
const researchSchema = {
  findings: {
    schema: z.object({ key: z.string(), domain: z.string(), text: z.string() }),
    type: "shared:finding",
    primaryKey: "key",
  },
}
```

Each entry requires `type` and `primaryKey`. `schema` is optional but recommended for validation. The `type` is the event type string written to the backing durable stream.

## Creating shared state

The parent entity creates the shared DB stream, typically on `firstWake`:

```ts
if (ctx.firstWake) {
  ctx.mkdb("research-123", researchSchema)
}
const shared = await ctx.observe(db("research-123", researchSchema))
```

`mkdb` creates the backing stream. It throws if the DB already exists — creation is always a one-time operation guarded by `firstWake` or your own state checks.

`observe(db(id, schema))` returns a handle for reading and writing. Call it on any wake to get a handle to an existing shared DB.

`observe` accepts an optional `wake` option to re-wake the entity when the shared state changes:

```ts
const shared = await ctx.observe(db("research-123", researchSchema), {
  wake: { on: "change", debounceMs: 500 },
})
```

## Connecting from children

Pass the shared DB config to children via spawn args:

```ts
const child = await ctx.spawn(
  "worker",
  "specialist-1",
  {
    systemPrompt: "...",
    sharedDb: { id: "research-123", schema: researchSchema },
  },
  { initialMessage: "Research topic X", wake: "runFinished" }
)
```

The child entity connects using the args it receives:

```ts
async handler(ctx) {
  const args = ctx.args as { sharedDb: { id: string; schema: SharedStateSchemaMap } }
  const shared = await ctx.observe(db(args.sharedDb.id, args.sharedDb.schema))
  // Use shared.findings to read and write
}
```

## Using the handle

`SharedStateHandle` exposes collection proxies via `StateCollectionProxy` (the same insert/update/delete/get/toArray API):

```ts
// Insert
shared.findings.insert({
  key: "f1",
  domain: "physics",
  text: "Finding text...",
})

// Read
shared.findings.get("f1")
shared.findings.toArray

// Update
shared.findings.update("f1", (draft) => {
  draft.text = "Updated"
})

// Delete
shared.findings.delete("f1")
```

## SharedStateHandle type

```ts
type SharedStateHandle<TSchema extends SharedStateSchemaMap> = {
  id: string
} & { [K in keyof TSchema]: StateCollectionProxy }
```

The `id` property holds the stream identifier. Each key from the schema map becomes a `StateCollectionProxy`.

## Example: debate pattern

The debate pattern uses shared state for pro/con arguments. A moderator creates the stream, spawns workers for each side, and reads all arguments to make a ruling.

```ts
const debateSchema = {
  arguments: {
    schema: z.object({
      key: z.string(),
      side: z.enum(["pro", "con"]),
      text: z.string(),
      round: z.number(),
    }),
    type: "shared:argument",
    primaryKey: "key",
  },
}

registry.define("debate", {
  state: {
    status: { primaryKey: "key" },
  },

  async handler(ctx) {
    if (ctx.firstWake) {
      ctx.mkdb(`debate-${ctx.entityUrl}`, debateSchema)
    }
    const shared = await ctx.observe(
      db(`debate-${ctx.entityUrl}`, debateSchema)
    )

    // Spawn pro and con workers with shared state access
    const pro = await ctx.spawn(
      "worker",
      "debate-pro",
      {
        systemPrompt: "Argue FOR the topic.",
        sharedDb: { id: `debate-${ctx.entityUrl}`, schema: debateSchema },
      },
      { initialMessage: "The topic is: ...", wake: "runFinished" }
    )

    const con = await ctx.spawn(
      "worker",
      "debate-con",
      {
        systemPrompt: "Argue AGAINST the topic.",
        sharedDb: { id: `debate-${ctx.entityUrl}`, schema: debateSchema },
      },
      { initialMessage: "The topic is: ...", wake: "runFinished" }
    )

    // Read all arguments written by both workers
    const allArgs = shared.arguments.toArray
  },
})
```
