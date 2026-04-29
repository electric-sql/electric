import type {
  AnyEntityDefinition,
  EntityActionMap,
  EntityDefinition,
  EntitySchema,
  EntityStateDefinition,
  EntityTypeEntry,
} from './types'

export class EntityRegistry {
  private entries = new Map<string, EntityTypeEntry>()

  define<
    const TCreationSchema extends EntitySchema | undefined = undefined,
    const TState extends EntityStateDefinition | undefined = undefined,
    TActions extends EntityActionMap = {},
  >(
    name: string,
    definition: EntityDefinition<TCreationSchema, TState, TActions>
  ): void {
    if (this.entries.has(name)) {
      throw new Error(`Entity type "${name}" is already registered`)
    }
    this.entries.set(name, {
      name,
      definition: definition as AnyEntityDefinition,
    })
  }

  get(name: string): EntityTypeEntry | undefined {
    return this.entries.get(name)
  }

  list(): Array<EntityTypeEntry> {
    return Array.from(this.entries.values())
  }

  clear(): void {
    this.entries.clear()
  }
}

const defaultRegistry = new EntityRegistry()

export function createEntityRegistry(): EntityRegistry {
  return new EntityRegistry()
}

/**
 * Define an entity type.
 *
 * Registers the entity definition (handler, state, actions)
 * with the runtime. On each run the runtime calls `handler(ctx, wake)`.
 */
export function defineEntity<
  const TCreationSchema extends EntitySchema | undefined = undefined,
  const TState extends EntityStateDefinition | undefined = undefined,
  TActions extends EntityActionMap = {},
>(
  name: string,
  definition: EntityDefinition<TCreationSchema, TState, TActions>
): void {
  defaultRegistry.define(name, definition)
}

export function getEntityType(name: string): EntityTypeEntry | undefined {
  return defaultRegistry.get(name)
}

export function listEntityTypes(): Array<EntityTypeEntry> {
  return defaultRegistry.list()
}

export function clearRegistry(): void {
  defaultRegistry.clear()
}

/**
 * Returns the `define` function for the given registry, falling back to the
 * default (module-level) registry when no registry is provided. Avoids
 * duplicating `registry ? registry.define.bind(registry) : defineEntity`
 * at every agent registration call site.
 */
export function resolveDefine(
  registry?: EntityRegistry
): (name: string, definition: AnyEntityDefinition) => void {
  return registry ? registry.define.bind(registry) : defineEntity
}
