---
title: Managing state
titleTemplate: "... - Electric Agents"
description: >-
  Declare and manage persistent entity state using custom collections with typed CRUD operations.
outline: [2, 3]
---

# Managing state

Entities can declare custom persistent collections. The convenience API is `ctx.state.<name>.insert/update/delete/get/toArray`; the lower-level APIs are `ctx.db.actions.<name>_insert/update/delete` for writes and `ctx.db.collections.<name>` for reads. State is backed by the entity's durable stream. Values survive process restarts and are available on every handler invocation.

## Declaring state

Define collections in the `state` field of the entity definition:

```ts
registry.define("my-entity", {
  state: {
    status: { primaryKey: "key" },
    items: {
      schema: z.object({
        key: z.string(),
        name: z.string(),
        count: z.number(),
      }),
      primaryKey: "key",
    },
  },
  async handler(ctx) {
    /* ... */
  },
})
```

Each key in `state` becomes a collection exposed on `ctx.state`, `ctx.db.actions`, and `ctx.db.collections`.

## CollectionDefinition

```ts
interface CollectionDefinition {
  schema?: StandardSchemaV1 // Zod or any Standard Schema validator
  type?: string // Event type in the stream. Defaults to "state:{name}"
  primaryKey?: string // Key field. Defaults to "key"
}
```

All fields are optional. A minimal collection like `{ primaryKey: 'key' }` works without a schema — rows are untyped.

## Writing and reading state

Use `ctx.state.<collection>` for normal handler code. Its `insert`, `update`, and `delete` methods route through generated actions; its `get` and `toArray` members read from the underlying TanStack DB collection.

The lower-level `ctx.db.actions` object exposes action methods named `<collection>_insert`, `<collection>_update`, and `<collection>_delete`. Reads go through `ctx.db.collections`, which exposes TanStack DB collection objects with `.get(key)` and `.toArray`.

Write helpers return a Transaction. Reads query the underlying TanStack DB collection.

## CRUD operations

```ts
// Convenience API
ctx.state.items.insert({ key: "item-1", name: "Widget", count: 5 })
const itemViaState = ctx.state.items.get("item-1")
const allViaState = ctx.state.items.toArray
ctx.state.items.update("item-1", (draft) => {
  draft.count += 1
})
ctx.state.items.delete("item-1")

// Lower-level insert
ctx.db.actions.items_insert({
  row: { key: "item-1", name: "Widget", count: 5 },
})

// Lower-level read
const item = ctx.db.collections.items?.get("item-1")
const all = ctx.db.collections.items?.toArray

// Lower-level update (Immer-style draft)
ctx.db.actions.items_update({
  key: "item-1",
  updater: (draft) => {
    draft.count += 1
  },
})

// Lower-level delete
ctx.db.actions.items_delete({ key: "item-1" })
```

## Built-in collections

Every entity also has `ctx.db.collections` with runtime-managed collections: `runs`, `steps`, `texts`, `toolCalls`, `errors`, `inbox`, and more. These are read-only from the handler's perspective — the runtime writes to them as the agent operates. See [Built-in collections](../reference/built-in-collections) for details.
