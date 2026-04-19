---
title: SharedStateHandle
titleTemplate: "... - Electric Agents"
description: >-
  Type reference for SharedStateHandle: collection proxies and SharedStateSchemaMap interface.
outline: [2, 3]
---

# SharedStateHandle

Handle for a shared state stream, returned by `ctx.createSharedState()` and `ctx.connectSharedState()`. Provides typed collection proxies keyed by the collection names declared in the schema map.

**Source:** `@durable-streams/darix-runtime`

```ts
type SharedStateHandle<
  TSchema extends SharedStateSchemaMap = SharedStateSchemaMap,
> = {
  id: string
} & { [K in keyof TSchema]: StateCollectionProxy }
```

## Properties

| Property           | Type                                               | Description                                                                 |
| ------------------ | -------------------------------------------------- | --------------------------------------------------------------------------- |
| `id`               | `string`                                           | The shared state stream identifier.                                         |
| `[collectionName]` | [`StateCollectionProxy`](./state-collection-proxy) | One property per collection defined in the schema. Same API as `ctx.state`. |

## SharedStateSchemaMap

Defines the collections in a shared state stream.

```ts
type SharedStateSchemaMap = Record<string, SharedStateCollectionSchema>
```

## SharedStateCollectionSchema

```ts
interface SharedStateCollectionSchema {
  schema: unknown
  type: string
  primaryKey: string
}
```

| Field        | Type      | Description                                                      |
| ------------ | --------- | ---------------------------------------------------------------- |
| `schema`     | `unknown` | Zod or Standard Schema validator for the row type.               |
| `type`       | `string`  | Event type string used in the durable stream (e.g. `"finding"`). |
| `primaryKey` | `string`  | Primary key field name on the row (must be a string field).      |

## Example

```ts
const schema = {
  findings: {
    schema: z.object({
      key: z.string(),
      domain: z.string(),
      finding: z.string(),
    }),
    type: "finding",
    primaryKey: "key",
  },
}

const shared = ctx.createSharedState("research-findings", schema)
shared.findings.insert({ key: "f1", domain: "security", finding: "..." })
```
