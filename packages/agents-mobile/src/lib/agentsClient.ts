import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { appendPathToUrl } from '@electric-ax/agents-runtime/client'
import type { ComposerInputPayload } from '@electric-ax/agents-runtime/client'
import { serverFetch } from '@electric-ax/agents-server-ui/src/lib/auth-fetch'
import { z } from 'zod'

export type EntityStatus =
  | `spawning`
  | `running`
  | `idle`
  | `paused`
  | `stopping`
  | `stopped`
  | `killed`
export type EntitySignal =
  | `SIGINT`
  | `SIGHUP`
  | `SIGTERM`
  | `SIGKILL`
  | `SIGSTOP`
  | `SIGCONT`
  | `SIGUSR`

const ENTITY_STATUSES: [EntityStatus, ...Array<EntityStatus>] = [
  `spawning`,
  `running`,
  `idle`,
  `paused`,
  `stopping`,
  `stopped`,
  `killed`,
]

// Mirrors `dispatchPolicySchema` in agents-server-ui's
// `ElectricAgentsProvider.tsx` — permissive so unknown target shapes
// still sync. We read the `runner` target's id ("which runner runs this
// session") for display and to derive per-runner recents; other target
// kinds (e.g. webhook) carry no runner.
const dispatchPolicySchema = z.object({
  targets: z
    .array(
      z.object({
        type: z.string(),
        runnerId: z.string().optional(),
        url: z.string().optional(),
        subscription_id: z.string().optional(),
      })
    )
    .default([]),
})

export const entitySchema = z.object({
  url: z.string(),
  type: z.string(),
  status: z.enum(ENTITY_STATUSES),
  tags: z.record(z.string(), z.string()).default({}),
  spawn_args: z.record(z.string(), z.unknown()).default({}),
  sandbox: z
    .object({ profile: z.string(), key: z.string().optional() })
    .nullable()
    .optional(),
  dispatch_policy: dispatchPolicySchema.nullable().optional(),
  parent: z.string().nullable(),
  created_by: z.string().nullable().optional(),
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
  // Statically-declared slash commands for the type, used as the autocomplete
  // source on the new-session composer (where no entity stream exists yet).
  slash_commands: z
    .array(
      z.object({
        name: z.string(),
        description: z.string().optional(),
        arguments: z
          .array(
            z.object({
              name: z.string(),
              type: z.enum([`string`, `number`, `boolean`]),
              required: z.boolean().optional(),
              description: z.string().optional(),
            })
          )
          .optional(),
      })
    )
    .nullable()
    .optional(),
  serve_endpoint: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const sandboxProfileSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string().optional(),
  // True for off-host (remote-provider) sandboxes: the workspace lives in the
  // provider VM, so a host working directory doesn't apply.
  remote: z.boolean().optional(),
})

// Minimal subset of the runners shape — the columns the mobile picker
// needs to identify a runner and pass it as the dispatch target on
// spawn, plus `sandbox_profiles` to offer its advertised profiles and
// let the session-row info sheet resolve sandbox labels like the desktop
// hover card does.
export const runnerSchema = z.object({
  id: z.string(),
  owner_principal: z.string(),
  label: z.string(),
  kind: z.string(),
  admin_status: z.enum([`enabled`, `disabled`]),
  last_seen_at: z.string().nullable().optional(),
  // Coerce a missing/null jsonb column to an empty list — `.default([])`
  // covers `undefined` but not a Postgres NULL.
  sandbox_profiles: z.preprocess(
    (v) => (Array.isArray(v) ? v : []),
    z.array(sandboxProfileSchema)
  ),
})

export const userSchema = z.object({
  id: z.string(),
  display_name: z.string().nullable(),
  email: z.string().nullable(),
  avatar_url: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export const entityEffectivePermissionSchema = z.object({
  id: z.coerce.number(),
  entity_url: z.string(),
  source_entity_url: z.string(),
  source_grant_id: z.coerce.number(),
  permission: z.string(),
  subject_kind: z.string(),
  subject_value: z.string(),
  expires_at: z.string().nullable().optional(),
  created_at: z.string(),
})

export type ElectricEntity = z.infer<typeof entitySchema>
export type ElectricEntityType = z.infer<typeof entityTypeSchema>
export type ElectricRunner = z.infer<typeof runnerSchema>
export type ElectricSandboxProfile = z.infer<typeof sandboxProfileSchema>
export type ElectricUser = z.infer<typeof userSchema>
export type ElectricEntityEffectivePermission = z.infer<
  typeof entityEffectivePermissionSchema
>

export type EntitiesCollection = ReturnType<typeof createEntitiesCollection>
export type EntityTypesCollection = ReturnType<
  typeof createEntityTypesCollection
>
export type RunnersCollection = ReturnType<typeof createRunnersCollection>
export type UsersCollection = ReturnType<typeof createUsersCollection>
export type EntityEffectivePermissionsCollection = ReturnType<
  typeof createEntityEffectivePermissionsCollection
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
        // Inject Authorization from the active server's registered headers on
        // every shape fetch.
        fetchClient: serverFetch,
        params: {
          table: `entities`,
          columns: [
            `url`,
            `type`,
            `status`,
            `tags`,
            `spawn_args`,
            `sandbox`,
            `dispatch_policy`,
            `parent`,
            `created_by`,
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
            `sandbox_profiles`,
          ],
        },
      },
      getKey: (item) => item.id,
    })
  )
}

export function createUsersCollection(baseUrl: string) {
  return createCollection(
    electricCollectionOptions({
      id: `mobile-users:${baseUrl}`,
      schema: userSchema,
      shapeOptions: {
        url: appendPathToUrl(baseUrl, `/_electric/electric/v1/shape`),
        fetchClient: serverFetch,
        params: {
          table: `users`,
          columns: [
            `id`,
            `display_name`,
            `email`,
            `avatar_url`,
            `created_at`,
            `updated_at`,
          ],
        },
      },
      getKey: (item) => item.id,
    })
  )
}

export function createEntityEffectivePermissionsCollection(baseUrl: string) {
  return createCollection(
    electricCollectionOptions({
      id: `mobile-entity-effective-permissions:${baseUrl}`,
      schema: entityEffectivePermissionSchema,
      shapeOptions: {
        url: appendPathToUrl(baseUrl, `/_electric/electric/v1/shape`),
        fetchClient: serverFetch,
        params: { table: `entity_effective_permissions` },
      },
      getKey: (item) => item.id,
    })
  )
}

export async function spawnEntity({
  baseUrl,
  type,
  initialMessage,
  initialMessageType,
  args,
  runnerId,
  sandboxProfile,
  workingDirectory,
}: {
  baseUrl: string
  type: string
  // Plain text, or a structured composer_input payload — pass
  // `initialMessageType` alongside the latter.
  initialMessage?: string | ComposerInputPayload
  initialMessageType?: string
  // Creation-schema args merged into the entity's spawn_args. The same channel
  // desktop uses for schema-form values and model settings; `workingDirectory`
  // is folded in as one such key.
  args?: Record<string, unknown>
  // When set, the cloud agents-server routes wake events for this
  // entity to the named pull-wake runner. Without it, dispatch falls
  // back to the entity type's `default_dispatch_policy` — typically a
  // webhook to a local serveEndpoint, which the cloud server can't
  // reach.
  runnerId?: string
  // Sandbox profile advertised by the target runner. Required for
  // `workingDirectory` to take effect — the runtime only resolves the
  // working-directory arg through a profile's sandbox factory; with no
  // profile it falls back to its own process cwd.
  sandboxProfile?: string
  workingDirectory?: string
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
  if (typeof initialMessage === `string`) {
    const text = initialMessage.trim()
    if (text) body.initialMessage = text
  } else if (initialMessage !== undefined) {
    body.initialMessage = initialMessage
    if (initialMessageType) body.initialMessageType = initialMessageType
  }
  if (runnerId) {
    body.dispatch_policy = {
      targets: [{ type: `runner`, runnerId }],
    }
  }
  if (sandboxProfile) {
    // Key by the session URL for a persistent, shared workspace: files
    // survive across wakes and spawned subagents share the container.
    body.sandbox = { profile: sandboxProfile, key: entityUrl }
  }
  const mergedArgs = {
    ...args,
    ...(workingDirectory ? { workingDirectory } : {}),
  }
  if (Object.keys(mergedArgs).length > 0) body.args = mergedArgs
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

export async function signalEntity({
  baseUrl,
  entityUrl,
  signal,
  reason,
  payload,
}: {
  baseUrl: string
  entityUrl: string
  signal: EntitySignal
  reason?: string
  payload?: unknown
}): Promise<void> {
  const body: Record<string, unknown> = { signal }
  if (reason !== undefined) body.reason = reason
  if (payload !== undefined) body.payload = payload

  const res = await serverFetch(
    appendPathToUrl(
      baseUrl,
      `/_electric/entities${entityUrl.startsWith(`/`) ? entityUrl : `/${entityUrl}`}/signal`
    ),
    {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify(body),
    }
  )
  if (!res.ok) {
    throw new Error(await responseMessage(res, `Signal failed`))
  }
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
