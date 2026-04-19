---
title: Defining entities
titleTemplate: "... - Electric Agents"
description: >-
  Register entity types with the EntityRegistry, define custom state collections, typed schemas, and handler functions.
outline: [2, 3]
---

# Defining entities

An entity type is registered with an `EntityRegistry`. The registry maps type names to `EntityDefinition` objects that declare the entity's state, schemas, and handler.

## Registry

`createEntityRegistry()` returns an `EntityRegistry`. Register types with `registry.define(name, definition)`.

```ts
import { createEntityRegistry } from "@durable-streams/darix-runtime"

const registry = createEntityRegistry()

registry.define("assistant", {
  description: "A general-purpose AI assistant",
  async handler(ctx) {
    ctx.configureAgent({
      systemPrompt: "You are a helpful assistant.",
      model: "claude-sonnet-4-5-20250929",
      tools: [...ctx.darixTools],
    })
    await ctx.agent.run()
  },
})
```

Calling `registry.define()` with a name that is already registered throws an error.

## EntityDefinition

```ts
interface EntityDefinition<TState extends StateProxy = StateProxy> {
  description?: string
  state?: Record<string, CollectionDefinition>
  actions?: (
    collections: Record<string, unknown>
  ) => Record<string, (...args: unknown[]) => void>
  creationSchema?: StandardJSONSchemaV1
  inboxSchemas?: Record<string, StandardJSONSchemaV1>
  outputSchemas?: Record<string, StandardJSONSchemaV1>
  handler: (
    ctx: HandlerContext<TState>,
    wake: WakeEvent
  ) => void | Promise<void>
}
```

| Field            | Purpose                                                                   |
| ---------------- | ------------------------------------------------------------------------- |
| `description`    | Human-readable description. Shown in the UI and CLI.                      |
| `state`          | Custom persistent collections available on `ctx.state`.                   |
| `actions`        | Factory that returns named action functions. Receives collection handles. |
| `creationSchema` | JSON Schema for arguments passed when the entity is spawned.              |
| `inboxSchemas`   | JSON Schemas for typed inbox message categories.                          |
| `outputSchemas`  | JSON Schemas for typed output message categories.                         |
| `handler`        | The function that runs each time the entity wakes. Required.              |

## Custom state

Declare named collections in the `state` field. Each collection is a `CollectionDefinition`:

```ts
interface CollectionDefinition {
  schema?: StandardSchemaV1
  type?: string
  primaryKey?: string
}
```

| Field        | Default          | Purpose                                                                 |
| ------------ | ---------------- | ----------------------------------------------------------------------- |
| `schema`     | none             | Optional Standard Schema validator (e.g. Zod). Validates rows on write. |
| `type`       | `"state:{name}"` | Event type string used in the durable stream.                           |
| `primaryKey` | `"key"`          | The field used as the primary key for the collection.                   |

Declared collections become typed properties on `ctx.state`:

```ts
import { z } from "zod"

const childSchema = z.object({
  key: z.string(),
  url: z.string(),
  kind: z.string(),
})

registry.define("coordinator", {
  description: "Spawns and tracks child entities",
  state: {
    status: { primaryKey: "key" },
    children: { schema: childSchema, primaryKey: "key" },
  },

  async handler(ctx) {
    if (ctx.firstWake) {
      ctx.state.status.insert({ key: "current", value: "idle" })
    }
    // ctx.state.children.insert(), .get(), .update(), .delete(), .toArray
  },
})
```

Each collection exposes a `StateCollectionProxy`:

```ts
interface StateCollectionProxy<T extends object = Record<string, unknown>> {
  insert: (row: T) => unknown
  update: (key: string, updater: (draft: T) => void) => unknown
  delete: (key: string) => unknown
  get: (key: string) => T | undefined
  toArray: Array<T>
}
```

## Typed state with generics

Pass a type parameter to `registry.define<TState>()` to get typed access to `ctx.state`:

```ts
type MyState = {
  kv: StateCollectionProxy<{ key: string; value: string }>
  inventory: StateCollectionProxy<{ key: string; count: number }>
} & Record<string, StateCollectionProxy>

registry.define<MyState>("assistant", {
  description: "Assistant with typed state",
  state: {
    kv: { primaryKey: "key" },
    inventory: { primaryKey: "key" },
  },

  async handler(ctx) {
    // ctx.state.kv and ctx.state.inventory are fully typed
    ctx.state.kv.insert({ key: "name", value: "Alice" })
  },
})
```

## Registry pattern

For projects with multiple entity types, keep a separate registry file and import register functions:

```ts
// entities/registry.ts
import { createEntityRegistry } from "@durable-streams/darix-runtime"
import { registerAssistant } from "./assistant"
import { registerWorker } from "./worker"

export const registry = createEntityRegistry()
registerAssistant(registry)
registerWorker(registry)
```

```ts
// entities/assistant.ts
import type { EntityRegistry } from "@durable-streams/darix-runtime"

export function registerAssistant(registry: EntityRegistry) {
  registry.define("assistant", {
    description: "General-purpose assistant",
    async handler(ctx) {
      ctx.configureAgent({
        systemPrompt: "You are a helpful assistant.",
        model: "claude-sonnet-4-5-20250929",
        tools: [...ctx.darixTools],
      })
      await ctx.agent.run()
    },
  })
}
```

This keeps each entity type isolated and the registry composition explicit.

## Schemas

`creationSchema`, `inboxSchemas`, and `outputSchemas` accept [`StandardJSONSchemaV1`](https://github.com/standard-schema/standard-schema) objects. Any schema library implementing the Standard JSON Schema interface works (e.g. Zod v4). These schemas are used for validation and for generating UI and documentation in the dashboard.

```ts
import { z } from "zod/v4"

registry.define("processor", {
  description: "Processes structured tasks",
  creationSchema: z.object({
    priority: z.enum(["low", "medium", "high"]),
  }),
  inboxSchemas: {
    task: z.object({
      title: z.string(),
      body: z.string().optional(),
    }),
  },
  async handler(ctx) {
    // ctx.args.priority is available from creationSchema
  },
})
```
