import { z } from 'zod'
import type { CollectionDefinition } from '@durable-streams/state'

export type EntityTags = Record<string, string>
export type TagOperation = `insert` | `update` | `delete`

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === `object` &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  )
}

export function assertTags(input: unknown): EntityTags {
  if (!isPlainObject(input)) {
    throw new Error(`[agent-runtime] tags must be a plain object`)
  }

  const tags: EntityTags = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value !== `string`) {
      throw new Error(`[agent-runtime] tag "${key}" must have a string value`)
    }
    tags[key] = value
  }

  return tags
}

export function normalizeTags(tags: EntityTags): EntityTags {
  return Object.keys(tags)
    .sort()
    .reduce((sorted, key) => {
      sorted[key] = tags[key]!
      return sorted
    }, {} as EntityTags)
}

// Encoding contract: tags_index entries must exactly match this output. The
// server's text[] column and Electric shape `@>` filters depend on it; any
// change here is a cross-package wire-format break.
export function buildTagsIndex(tags: EntityTags): Array<string> {
  return Object.entries(tags)
    .map(([key, value]) => JSON.stringify([key, value]))
    .sort()
}

// 64-bit FNV-1a. Output is part of the public stream path
// (`/_entities/<hash>`) and the entity_bridges primary key, so the algorithm
// is wire-format stable — do not change without a migration.
export function hashString(value: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (let index = 0; index < value.length; index++) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, `0`)
}

export function sourceRefForTags(tags: EntityTags): string {
  return hashString(JSON.stringify(normalizeTags(tags)))
}

export function getEntitiesStreamPath(sourceRef: string): string {
  return `/_entities/${sourceRef}`
}

export function getEntitiesStreamPathForTags(tags: EntityTags): string {
  return getEntitiesStreamPath(sourceRefForTags(tags))
}

const entityStatuses = [`spawning`, `running`, `idle`, `stopped`] as const

export const entityMembershipRowSchema = z.object({
  url: z.string(),
  type: z.string(),
  status: z.enum(entityStatuses),
  tags: z.record(z.string(), z.string()).default({}),
  spawn_args: z.record(z.string(), z.unknown()).default({}),
  parent: z.string().nullable().optional(),
  type_revision: z.number().int().nullable().optional(),
  inbox_schemas: z.record(z.string(), z.unknown()).nullable().optional(),
  state_schemas: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: z.number(),
  updated_at: z.number(),
})

export type EntityMembershipRow = z.infer<typeof entityMembershipRowSchema>

export const entitiesObservationCollections = {
  members: {
    schema: entityMembershipRowSchema,
    type: `members`,
    primaryKey: `url`,
  },
} satisfies Record<string, CollectionDefinition>
