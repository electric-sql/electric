---
title: Managing state
titleTemplate: "... - Electric Agents"
description: >-
  Declare and manage persistent entity state using custom collections with typed CRUD operations.
outline: [2, 3]
---

# Managing state

Entities can declare custom persistent collections. State is accessed via `ctx.state.<name>` in the handler and is backed by the entity's durable stream. Values survive process restarts and are available on every handler invocation.

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

Each key in `state` becomes a collection accessible as `ctx.state.<name>`.

## CollectionDefinition

```ts
interface CollectionDefinition {
  schema?: StandardSchemaV1 // Zod or any Standard Schema validator
  type?: string // Event type in the stream. Defaults to "state:{name}"
  primaryKey?: string // Key field. Defaults to "key"
}
```

All fields are optional. A minimal collection like `{ primaryKey: 'key' }` works without a schema — rows are untyped.

## StateCollectionProxy

Each collection on `ctx.state` is a `StateCollectionProxy`:

```ts
interface StateCollectionProxy<T extends object = Record<string, unknown>> {
  insert(row: T): unknown // Returns Transaction
  update(key: string, updater: (draft: T) => void): unknown
  delete(key: string): unknown
  get(key: string): T | undefined
  toArray: T[] // Getter, not a method
}
```

Mutating methods (`insert`, `update`, `delete`) return a Transaction. Reads (`get`, `toArray`) query the underlying TanStack DB collection.

## CRUD operations

```ts
// Insert
ctx.state.items.insert({ key: "item-1", name: "Widget", count: 5 })

// Read
const item = ctx.state.items.get("item-1")
const all = ctx.state.items.toArray

// Update (Immer-style draft)
ctx.state.items.update("item-1", (draft) => {
  draft.count += 1
})

// Delete
ctx.state.items.delete("item-1")
```

## Typed state

Use a generic parameter on `registry.define<TState>()` to get type-safe access to `ctx.state`:

```ts
type MyState = {
  kv: StateCollectionProxy<{ key: string; value: string }>
  items: StateCollectionProxy<{ key: string; name: string }>
} & Record<string, StateCollectionProxy>

registry.define<MyState>("my-entity", {
  state: {
    kv: { primaryKey: "key" },
    items: { primaryKey: "key" },
  },
  async handler(ctx) {
    // ctx.state.kv and ctx.state.items are fully typed
    ctx.state.kv.insert({ key: "foo", value: "bar" })
  },
})
```

## Built-in collections

Every entity also has `ctx.db.collections` with runtime-managed collections: `runs`, `steps`, `texts`, `toolCalls`, `errors`, `inbox`, and more. These are read-only from the handler's perspective — the runtime writes to them as the agent operates. See [Built-in collections](../reference/built-in-collections) for details.
