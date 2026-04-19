---
title: StateCollectionProxy
titleTemplate: "... - Electric Agents"
description: >-
  API reference for StateCollectionProxy: insert, update, delete, get, and toArray operations.
outline: [2, 3]
---

# StateCollectionProxy

Proxy handle for a custom state collection, accessed via `ctx.state.<name>`. Mutations are routed through auto-generated CRUD actions. Reads delegate to the underlying TanStack DB collection.

**Source:** `@durable-streams/darix-runtime`

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

- Mutating methods (`insert`, `update`, `delete`) return a Transaction. These are fire-and-forget -- the write is persisted to the entity's durable stream asynchronously.
- The `update` method uses Immer-style drafts. Mutate the draft directly rather than returning a new object.
- `toArray` is a property, not a method call. Access it without parentheses: `ctx.state.items.toArray`.
