---
title: StateCollectionProxy
titleTemplate: '... - Electric Agents'
description: >-
  API reference for StateCollectionProxy: insert, update, delete, get, and toArray operations.
outline: [2, 3]
---

# StateCollectionProxy

Proxy handle for a state collection. Entity-local state exposes these proxies on `ctx.state.<collection>`, and shared state exposes them on a `SharedStateHandle` returned by `ctx.mkdb()` or `await ctx.observe(db(...))`. Mutations are routed through auto-generated CRUD actions. Reads delegate to the underlying TanStack DB collection.

> **Note:** Entity state can also be accessed through the lower-level `ctx.db.actions.<coll>_insert/update/delete` and `ctx.db.collections.<coll>?.get/toArray` APIs. `ctx.state` is the proxy convenience layer over those APIs.

**Source:** `@electric-ax/agents-runtime`

```ts
interface StateCollectionProxy<T extends object = Record<string, unknown>> {
  insert(row: T): unknown
  update(key: string, updater: (draft: T) => void): unknown
  delete(key: string): unknown
  get(key: string): T | undefined
  toArray: T[]
}
```

## Members

| Member                 | Parameters                                   | Return Type      | Description                                                             |
| ---------------------- | -------------------------------------------- | ---------------- | ----------------------------------------------------------------------- |
| `insert(row)`          | `row: T`                                     | `Transaction`    | Insert a new row into the collection.                                   |
| `update(key, updater)` | `key: string`, `updater: (draft: T) => void` | `Transaction`    | Update a row by key. The updater receives an Immer-style mutable draft. |
| `delete(key)`          | `key: string`                                | `Transaction`    | Delete a row by key.                                                    |
| `get(key)`             | `key: string`                                | `T \| undefined` | Read a single row by key. Returns `undefined` if not found.             |
| `toArray`              | -                                            | `T[]`            | All rows as an array. This is a getter property, not a method.          |

## Notes

- Mutating methods (`insert`, `update`, `delete`) return a Transaction. These are fire-and-forget -- the write is persisted to the backing durable stream asynchronously.
- The `update` method uses Immer-style drafts. Mutate the draft directly rather than returning a new object.
- `toArray` is a property, not a method call. Access it without parentheses: `ctx.state.items.toArray` or `shared.items.toArray`.
