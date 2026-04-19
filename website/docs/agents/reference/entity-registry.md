---
title: EntityRegistry
titleTemplate: "... - Electric Agents"
description: >-
  API reference for EntityRegistry: define, get, list, and clear entity type registrations.
outline: [2, 3]
---

# EntityRegistry

Manages entity type registrations. Create an isolated registry with `createEntityRegistry()`, or use the module-level convenience functions for a shared default registry.

**Source:** `@durable-streams/darix-runtime`

```ts
class EntityRegistry {
  define<TState extends StateProxy>(
    name: string,
    definition: EntityDefinition<TState>
  ): void
  get(name: string): EntityTypeEntry | undefined
  list(): EntityTypeEntry[]
  clear(): void
}

function createEntityRegistry(): EntityRegistry
```

## Methods

| Method                     | Parameters                                     | Return Type                    | Description                                                      |
| -------------------------- | ---------------------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| `define(name, definition)` | `name: string`, `definition: EntityDefinition` | `void`                         | Register an entity type. Throws if `name` is already registered. |
| `get(name)`                | `name: string`                                 | `EntityTypeEntry \| undefined` | Look up a registered type by name.                               |
| `list()`                   | -                                              | `EntityTypeEntry[]`            | Return all registered types.                                     |
| `clear()`                  | -                                              | `void`                         | Remove all registrations.                                        |

## EntityTypeEntry

```ts
interface EntityTypeEntry {
  name: string
  definition: EntityDefinition
}
```

| Field        | Type                                      | Description                 |
| ------------ | ----------------------------------------- | --------------------------- |
| `name`       | `string`                                  | The registered type name.   |
| `definition` | [`EntityDefinition`](./entity-definition) | The full entity definition. |

## Module-level functions

These operate on a shared default registry. Use them when you do not need isolated registries.

```ts
function defineEntity<TState extends StateProxy>(
  name: string,
  definition: EntityDefinition<TState>
): void

function getEntityType(name: string): EntityTypeEntry | undefined

function listEntityTypes(): EntityTypeEntry[]

function clearRegistry(): void

function resolveDefine(
  registry?: EntityRegistry
): (name: string, definition: EntityDefinition) => void
```

| Function                         | Description                                                                                                                             |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `defineEntity(name, definition)` | Register a type on the default registry.                                                                                                |
| `getEntityType(name)`            | Look up a type on the default registry.                                                                                                 |
| `listEntityTypes()`              | List all types on the default registry.                                                                                                 |
| `clearRegistry()`                | Clear the default registry.                                                                                                             |
| `resolveDefine(registry?)`       | Returns `registry.define` if a registry is provided, otherwise `defineEntity`. Convenience for code that optionally accepts a registry. |
