import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { z } from 'zod'

export type EntityStatus = `spawning` | `running` | `idle` | `stopped`

const ENTITY_STATUSES: [EntityStatus, ...Array<EntityStatus>] = [
  `spawning`,
  `running`,
  `idle`,
  `stopped`,
]

export const entitySchema = z.object({
  url: z.string(),
  type: z.string(),
  status: z.enum(ENTITY_STATUSES),
  tags: z.record(z.string(), z.string()).default({}),
  spawn_args: z.record(z.string(), z.unknown()).default({}),
  parent: z.string().nullable(),
  type_revision: z.coerce.number().nullable().optional(),
  inbox_schemas: z.record(z.string(), z.unknown()).nullable().optional(),
  state_schemas: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: z.coerce.number(),
  updated_at: z.coerce.number(),
})

export const entityTypeSchema = z.object({
  name: z.string(),
  description: z.string(),
  creation_schema: z.unknown().nullable(),
  inbox_schemas: z.record(z.string(), z.unknown()).nullable(),
  state_schemas: z.record(z.string(), z.unknown()).nullable(),
  serve_endpoint: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type ElectricEntity = z.infer<typeof entitySchema>
export type ElectricEntityType = z.infer<typeof entityTypeSchema>

export type EntitiesCollection = ReturnType<typeof createEntitiesCollection>
export type EntityTypesCollection = ReturnType<
  typeof createEntityTypesCollection
>

export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, ``)
  if (!trimmed) return ``
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `http://${trimmed}`
}

export async function checkServerHealth(serverUrl: string): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  const res = await fetch(`${serverUrl}/_electric/health`, {
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout))
  if (!res.ok) {
    throw new Error(`Health check failed (${res.status})`)
  }
}

export function createEntitiesCollection(baseUrl: string) {
  return createCollection(
    electricCollectionOptions({
      id: `mobile-entities:${baseUrl}`,
      schema: entitySchema,
      shapeOptions: {
        url: `${baseUrl}/_electric/electric/v1/shape`,
        params: {
          table: `entities`,
          columns: [
            `url`,
            `type`,
            `status`,
            `tags`,
            `spawn_args`,
            `parent`,
            `type_revision`,
            `inbox_schemas`,
            `state_schemas`,
            `created_at`,
            `updated_at`,
          ],
        },
        parser: {
          int8: (v: string) => Number(v),
        },
      },
      getKey: (item) => item.url,
    })
  )
}

export function createEntityTypesCollection(baseUrl: string) {
  return createCollection(
    electricCollectionOptions({
      id: `mobile-entity-types:${baseUrl}`,
      schema: entityTypeSchema,
      shapeOptions: {
        url: `${baseUrl}/_electric/electric/v1/shape`,
        params: { table: `entity_types` },
      },
      getKey: (item) => item.name,
    })
  )
}

export async function spawnEntity({
  baseUrl,
  type,
  initialMessage,
}: {
  baseUrl: string
  type: string
  initialMessage?: string
}): Promise<string> {
  const name = makeEntityName()
  const entityUrl = `/${type}/${name}`
  const spawnRes = await fetch(`${baseUrl}${entityUrl}`, {
    method: `PUT`,
    headers: { 'content-type': `application/json` },
    body: JSON.stringify({}),
  })
  if (!spawnRes.ok) {
    throw new Error(await responseMessage(spawnRes, `Spawn failed`))
  }

  const text = initialMessage?.trim()
  if (text) {
    const sendRes = await fetch(`${baseUrl}${entityUrl}/send`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        from: `user`,
        payload: { text },
      }),
    })
    if (!sendRes.ok) {
      throw new Error(await responseMessage(sendRes, `Send failed`))
    }
  }

  return entityUrl
}

export function getEntityDisplayTitle(entity: ElectricEntity): string {
  const tagTitle = entity.tags.title
  if (typeof tagTitle === `string` && tagTitle.length > 0) return tagTitle

  for (const [key, value] of Object.entries(entity.tags)) {
    if ([`swarm_id`, `source`, `parent`].includes(key)) continue
    if (typeof value === `string` && value.length > 0) return value
  }

  for (const key of [
    `prompt`,
    `task`,
    `topic`,
    `corpus`,
    `description`,
    `message`,
    `title`,
  ]) {
    const value = entity.spawn_args[key]
    if (typeof value === `string` && value.length > 0) {
      return value.slice(0, 80)
    }
  }

  return decodeURIComponent(entity.url.split(`/`).pop() ?? entity.url)
}

async function responseMessage(
  res: Response,
  fallback: string
): Promise<string> {
  const body = await res.text().catch(() => ``)
  if (!body) return `${fallback} (${res.status})`
  try {
    const data = JSON.parse(body) as Record<string, unknown>
    const message = data.message ?? data.error
    if (typeof message === `string`) return message
  } catch {
    // Use the raw response below.
  }
  return body
}

function makeEntityName(): string {
  const suffix = Math.random().toString(36).slice(2, 10)
  return `mobile-${Date.now().toString(36)}-${suffix}`
}
