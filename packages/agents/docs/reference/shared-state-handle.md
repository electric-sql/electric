---
title: SharedStateHandle
titleTemplate: '... - Electric Agents'
description: >-
  Type reference for SharedStateHandle: collection proxies and SharedStateSchemaMap interface.
outline: [2, 3]
---

# SharedStateHandle

Handle for a shared state stream, returned by `ctx.mkdb()` and `await ctx.observe(db(...))`. Provides typed collection proxies keyed by the collection names declared in the schema map.

**Source:** `@electric-ax/agents-runtime`

```ts
type SharedStateHandle<
  TSchema extends SharedStateSchemaMap = SharedStateSchemaMap,
> = {
  id: string
} & { [K in keyof TSchema]: StateCollectionProxy }
```

## Properties

| Property           | Type                                               | Description                                                                                   |
| ------------------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `id`               | `string`                                           | The shared state stream identifier.                                                           |
| `[collectionName]` | [`StateCollectionProxy`](./state-collection-proxy) | One property per collection defined in the schema. Provides insert/update/delete/get/toArray. |

## SharedStateSchemaMap

Defines the collections in a shared state stream.

```ts
type SharedStateSchemaMap = Record<string, SharedStateCollectionSchema>
```

## SharedStateCollectionSchema

```ts
interface SharedStateCollectionSchema {
  schema?: StandardSchemaV1
  type: string
  primaryKey: string
}
```

| Field        | Type               | Required | Description                                                      |
| ------------ | ------------------ | -------- | ---------------------------------------------------------------- |
| `schema`     | `StandardSchemaV1` | No       | Zod or Standard Schema validator for the row type.               |
| `type`       | `string`           | Yes      | Event type string used in the durable stream (e.g. `"finding"`). |
| `primaryKey` | `string`           | Yes      | Primary key field name on the row (must be a string field).      |

## Example

```ts
import { db } from '@electric-ax/agents-runtime'

const schema = {
  findings: {
    schema: z.object({
      key: z.string(),
      domain: z.string(),
      finding: z.string(),
    }),
    type: 'finding',
    primaryKey: 'key',
  },
}

ctx.mkdb('research-findings', schema)
const shared = await ctx.observe(db('research-findings', schema))
shared.findings.insert({ key: 'f1', domain: 'security', finding: '...' })
```
