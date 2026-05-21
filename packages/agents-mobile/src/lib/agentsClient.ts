import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { appendPathToUrl } from '@electric-ax/agents-runtime/client'
import { serverFetch } from '@electric-ax/agents-server-ui/src/lib/auth-fetch'
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

// Minimal subset of the runners shape — just the columns the mobile
// picker needs to identify a runner and pass it as the dispatch
// target on spawn.
export const runnerSchema = z.object({
  id: z.string(),
  owner_principal: z.string(),
  label: z.string(),
  kind: z.string(),
  admin_status: z.enum([`enabled`, `disabled`]),
  last_seen_at: z.string().nullable().optional(),
})

export type ElectricEntity = z.infer<typeof entitySchema>
export type ElectricEntityType = z.infer<typeof entityTypeSchema>
export type ElectricRunner = z.infer<typeof runnerSchema>

export type EntitiesCollection = ReturnType<typeof createEntitiesCollection>
export type EntityTypesCollection = ReturnType<
  typeof createEntityTypesCollection
>
export type RunnersCollection = ReturnType<typeof createRunnersCollection>

export function normalizeServerUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, ``)
  if (!trimmed) return ``
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return `http://${trimmed}`
}

export async function checkServerHealth(serverUrl: string): Promise<void> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)
  const res = await serverFetch(
    appendPathToUrl(serverUrl, `/_electric/health`),
    { signal: controller.signal }
  ).finally(() => clearTimeout(timeout))
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
        url: appendPathToUrl(baseUrl, `/_electric/electric/v1/shape`),
        // Inject Authorization / x-electric-service from the active
        // server's registered headers on every shape fetch.
        fetchClient: serverFetch,
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
        url: appendPathToUrl(baseUrl, `/_electric/electric/v1/shape`),
        fetchClient: serverFetch,
        params: { table: `entity_types` },
      },
      getKey: (item) => item.name,
    })
  )
}

export function createRunnersCollection(baseUrl: string) {
  return createCollection(
    electricCollectionOptions({
      id: `mobile-runners:${baseUrl}`,
      schema: runnerSchema,
      shapeOptions: {
        url: appendPathToUrl(baseUrl, `/_electric/electric/v1/shape`),
        fetchClient: serverFetch,
        params: {
          table: `runners`,
          columns: [
            `id`,
            `owner_principal`,
            `label`,
            `kind`,
            `admin_status`,
            `last_seen_at`,
          ],
        },
      },
      getKey: (item) => item.id,
    })
  )
}

export async function spawnEntity({
  baseUrl,
  type,
  initialMessage,
  runnerId,
}: {
  baseUrl: string
  type: string
  initialMessage?: string
  // When set, the cloud agents-server routes wake events for this
  // entity to the named pull-wake runner. Without it, dispatch falls
  // back to the entity type's `default_dispatch_policy` — typically a
  // webhook to a local serveEndpoint, which the cloud server can't
  // reach.
  runnerId?: string
}): Promise<string> {
  const name = makeEntityName()
  const entityUrl = `/${type}/${name}`
  // Spawn endpoint lives under `/_electric/entities/<type>/<name>` and
  // takes `initialMessage` in the request body — the server creates
  // the entity, provisions its streams, and writes the first inbox
  // row atomically. Doing this as PUT-then-POST(/send) used to race:
  // the spawn ack could return before the streams were ready, and the
  // immediate /send would 404 with STREAM_NOT_FOUND.
  const body: Record<string, unknown> = {}
  const text = initialMessage?.trim()
  if (text) body.initialMessage = text
  if (runnerId) {
    body.dispatch_policy = {
      targets: [{ type: `runner`, runnerId }],
    }
  }
  const spawnRes = await serverFetch(
    appendPathToUrl(
      baseUrl,
      `/_electric/entities/${encodeURIComponent(type)}/${encodeURIComponent(name)}`
    ),
    {
      method: `PUT`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify(body),
    }
  )
  if (!spawnRes.ok) {
    throw new Error(await responseMessage(spawnRes, `Spawn failed`))
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
