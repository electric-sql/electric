---
title: EntityDefinition
titleTemplate: '... - Electric Agents'
description: >-
  Type reference for EntityDefinition: description, state, schemas, and handler function signature.
outline: [2, 3]
---

# EntityDefinition

Defines an entity type's schema, state, and handler. Passed to `registry.define()` or `defineEntity()`.

**Source:** `@electric-ax/agents-runtime`

```ts
interface EntityDefinition {
  description?: string
  state?: Record<string, CollectionDefinition>
  actions?: (
    collections: Record<string, unknown>
  ) => Record<string, (...args: unknown[]) => void>
  creationSchema?: StandardJSONSchemaV1
  inboxSchemas?: Record<string, StandardJSONSchemaV1>
  outputSchemas?: Record<string, StandardJSONSchemaV1>
  handler(ctx: HandlerContext, wake: WakeEvent): void | Promise<void>
}
```

## Fields

| Field            | Type                                                 | Required | Description                                                                                                                     |
| ---------------- | ---------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `description`    | `string`                                             | No       | Human-readable description of the entity type. Used in type registration.                                                       |
| `state`          | `Record<string, CollectionDefinition>`               | No       | Custom state collections exposed via `ctx.db.actions` (writes) and `ctx.db.collections` (reads).                                |
| `actions`        | `(collections) => Record<string, (...args) => void>` | No       | Factory for custom non-CRUD actions. Receives TanStack DB collections, returns named action functions exposed on `ctx.actions`. |
| `creationSchema` | `StandardJSONSchemaV1`                               | No       | JSON Schema for spawn arguments validation.                                                                                     |
| `inboxSchemas`   | `Record<string, StandardJSONSchemaV1>`               | No       | JSON Schemas for inbound message types, keyed by message type.                                                                  |
| `outputSchemas`  | `Record<string, StandardJSONSchemaV1>`               | No       | JSON Schemas for output event types. Defaults are provided by the runtime.                                                      |
| `handler`        | `(ctx, wake) => void \| Promise<void>`               | Yes      | The function invoked on each wake. Receives [`HandlerContext`](./handler-context) and [`WakeEvent`](./wake-event).              |

## CollectionDefinition

Defines a custom state collection.

```ts
interface CollectionDefinition {
  schema?: StandardSchemaV1
  type?: string
  primaryKey?: string
}
```

| Field        | Type               | Default          | Description                                        |
| ------------ | ------------------ | ---------------- | -------------------------------------------------- |
| `schema`     | `StandardSchemaV1` | -                | Zod or Standard Schema validator for the row type. |
| `type`       | `string`           | `"state:{name}"` | Event type string used in the durable stream.      |
| `primaryKey` | `string`           | `"key"`          | Primary key field name on the row.                 |
