import { passthrough } from './entity-schema'
import type { CollectionDefinition as StateCollectionDefinition } from '@durable-streams/state'
import type { CollectionDefinition } from './types'

export function normalizeObservationSchema(
  schema: Record<string, CollectionDefinition>
): Record<string, StateCollectionDefinition> {
  const normalized: Record<string, StateCollectionDefinition> = {}

  for (const [name, definition] of Object.entries(schema)) {
    normalized[name] = {
      schema: definition.schema ?? passthrough(),
      type: definition.type ?? `state:${name}`,
      primaryKey: definition.primaryKey ?? `key`,
    }
  }

  return normalized
}
