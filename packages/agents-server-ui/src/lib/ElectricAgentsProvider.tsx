import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { createCollection, createOptimisticAction } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { z } from 'zod'
import { appendPathToUrl } from '@electric-ax/agents-runtime/client'
import type { EventPointer } from '@electric-ax/agents-runtime'
import type { ReactNode } from 'react'
import { serverFetch } from './auth-fetch'
import { entityApiUrl, entitySpawnApiUrl } from './entity-api'
import { showToast } from './toast'

type EntityStatus =
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

// --- Schemas ---

const ENTITY_STATUSES: [EntityStatus, ...Array<EntityStatus>] = [
  `spawning`,
  `running`,
  `idle`,
  `paused`,
  `stopping`,
  `stopped`,
  `killed`,
]

// A dispatch policy pins an entity's wakes to a target. We only need the
// `runner` target's id for display ("which runner runs this session"); other
// target kinds (e.g. webhook) carry no runner. Kept permissive so an unknown
// target shape syncs without tripping validation.
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

export type ElectricDispatchPolicy = z.infer<typeof dispatchPolicySchema>

const entitySchema = z.object({
  url: z.string(),
  type: z.string(),
  status: z.enum(ENTITY_STATUSES),
  tags: z.record(z.string()).default({}),
  spawn_args: z.record(z.unknown()).default({}),
  sandbox: z
    .object({ profile: z.string(), key: z.string().optional() })
    .nullable()
    .optional(),
  dispatch_policy: dispatchPolicySchema.nullable().optional(),
  parent: z.string().nullable(),
  type_revision: z.coerce.number().nullable().optional(),
  inbox_schemas: z.record(z.unknown()).nullable().optional(),
  state_schemas: z.record(z.unknown()).nullable().optional(),
  created_at: z.coerce.number(),
  updated_at: z.coerce.number(),
})

const entityTypeSchema = z.object({
  name: z.string(),
  description: z.string(),
  creation_schema: z.unknown().nullable(),
  inbox_schemas: z.record(z.unknown()).nullable(),
  state_schemas: z.record(z.unknown()).nullable(),
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

const sandboxProfileAdvertisementSchema = z.object({
  name: z.string(),
  label: z.string(),
  description: z.string().optional(),
  // True for off-host (remote-provider) sandboxes: the workspace lives in the
  // provider VM, so a host working directory doesn't apply.
  remote: z.boolean().optional(),
})

const runnerDiagnosticsSchema = z.object({
  started_at: z.string().nullable().optional(),
  stream_connected: z.boolean().optional(),
  stream_connected_since: z.string().nullable().optional(),
  reconnect_count: z.number().optional(),
  last_error: z.string().nullable().optional(),
  last_error_at: z.string().nullable().optional(),
  last_heartbeat_at: z.string().nullable().optional(),
  last_heartbeat_ok: z.boolean().optional(),
  last_claim_at: z.string().nullable().optional(),
  last_claim_result: z
    .enum([`claimed`, `no_work`, `error`])
    .nullable()
    .optional(),
  last_dispatch_at: z.string().nullable().optional(),
  events_received: z.number().optional(),
  claims_succeeded: z.number().optional(),
  claims_skipped: z.number().optional(),
  claims_failed: z.number().optional(),
})

const runnerSchema = z.object({
  id: z.string(),
  owner_principal: z.string(),
  label: z.string(),
  kind: z.string(),
  admin_status: z.enum([`enabled`, `disabled`]),
  wake_stream: z.string(),
  wake_stream_offset: z.string().nullable().optional(),
  last_seen_at: z.string().nullable().optional(),
  liveness_lease_expires_at: z.string().nullable().optional(),
  diagnostics: runnerDiagnosticsSchema.nullable().optional(),
  // Coerce a missing/null jsonb column to an empty list — `.default([])`
  // covers `undefined` but not a Postgres NULL.
  sandbox_profiles: z.preprocess(
    (v) => (Array.isArray(v) ? v : []),
    z.array(sandboxProfileAdvertisementSchema)
  ),
  created_at: z.string(),
  updated_at: z.string(),
})

const runnerRuntimeDiagnosticsSchema = z.object({
  runner_id: z.string(),
  owner_principal: z.string(),
  wake_stream_offset: z.string().nullable().optional(),
  last_seen_at: z.string(),
  liveness_lease_expires_at: z.string(),
  diagnostics: runnerDiagnosticsSchema.nullable().optional(),
  updated_at: z.string(),
})

export type ElectricEntity = z.infer<typeof entitySchema>
export type ElectricEntityType = z.infer<typeof entityTypeSchema>
export type ElectricRunner = z.infer<typeof runnerSchema>
export type ElectricSandboxProfile = z.infer<
  typeof sandboxProfileAdvertisementSchema
>
export type ElectricRunnerRuntimeDiagnostics = z.infer<
  typeof runnerRuntimeDiagnosticsSchema
>

// --- Collection factories ---

function createEntitiesCollection(baseUrl: string) {
  return createCollection(
    electricCollectionOptions({
      id: `entities`,
      schema: entitySchema,
      shapeOptions: {
        url: appendPathToUrl(baseUrl, `/_electric/electric/v1/shape`),
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
            `type_revision`,
            `inbox_schemas`,
            `state_schemas`,
            `created_at`,
            `updated_at`,
          ],
        },
        fetchClient: serverFetch,
        parser: {
          int8: (v: string) => Number(v),
        },
      },
      getKey: (item) => item.url,
    })
  )
}

function createEntityTypesCollection(baseUrl: string) {
  return createCollection(
    electricCollectionOptions({
      id: `entity-types`,
      schema: entityTypeSchema,
      shapeOptions: {
        url: appendPathToUrl(baseUrl, `/_electric/electric/v1/shape`),
        params: { table: `entity_types` },
        fetchClient: serverFetch,
      },
      getKey: (item) => item.name,
    })
  )
}

export function createRunnersCollection(baseUrl: string) {
  return createCollection(
    electricCollectionOptions({
      id: `runners`,
      schema: runnerSchema,
      shapeOptions: {
        url: appendPathToUrl(baseUrl, `/_electric/electric/v1/shape`),
        params: { table: `runners` },
        fetchClient: serverFetch,
      },
      getKey: (item) => item.id,
    })
  )
}

export function createRunnerRuntimeDiagnosticsCollection(
  baseUrl: string,
  runnerId: string
) {
  return createCollection(
    electricCollectionOptions({
      id: `runner-runtime-diagnostics:${baseUrl}:${runnerId}`,
      schema: runnerRuntimeDiagnosticsSchema,
      shapeOptions: {
        url: appendPathToUrl(baseUrl, `/_electric/electric/v1/shape`),
        params: {
          table: `runner_runtime_diagnostics`,
          where: `runner_id = $1`,
          params: { '1': runnerId },
        },
        fetchClient: serverFetch,
      },
      getKey: (item) => item.runner_id,
    })
  )
}

type EntitiesCollection = ReturnType<typeof createEntitiesCollection>
type EntityTypesCollection = ReturnType<typeof createEntityTypesCollection>
type RunnersCollection = ReturnType<typeof createRunnersCollection>

type AppCollections = {
  entities: EntitiesCollection
  entityTypes: EntityTypesCollection
  runners: RunnersCollection
}

const appCollectionsCache = new Map<string, AppCollections>()

function getOrCreateAppCollections(baseUrl: string): AppCollections {
  const cached = appCollectionsCache.get(baseUrl)
  if (cached) return cached
  const collections = {
    entities: createEntitiesCollection(baseUrl),
    entityTypes: createEntityTypesCollection(baseUrl),
    runners: createRunnersCollection(baseUrl),
  }
  appCollectionsCache.set(baseUrl, collections)
  return collections
}

function cleanupAppCollections(baseUrl: string): void {
  const collections = appCollectionsCache.get(baseUrl)
  if (!collections) return
  collections.entities.cleanup()
  collections.entityTypes.cleanup()
  collections.runners.cleanup()
  appCollectionsCache.delete(baseUrl)
}

function cleanupAppCollectionsExcept(activeBaseUrl: string | null): void {
  for (const baseUrl of appCollectionsCache.keys()) {
    if (baseUrl !== activeBaseUrl) cleanupAppCollections(baseUrl)
  }
}

export async function preloadAppCollections(
  baseUrl: string
): Promise<AppCollections> {
  const collections = getOrCreateAppCollections(baseUrl)
  await Promise.all([
    collections.entities.preload(),
    collections.entityTypes.preload(),
    collections.runners.preload(),
  ])
  return collections
}

// --- Actions ---

type RunnerDispatchPolicy = {
  targets: Array<{ type: `runner`; runnerId: string }>
}

interface SpawnInput {
  type: string
  name: string
  args?: Record<string, unknown>
  tags?: Record<string, string>
  parent?: string
  initialMessage?: unknown
  initialMessageType?: string
  dispatch_policy?: RunnerDispatchPolicy
  sandbox?: { profile: string; key?: string }
}

export interface SignalInput {
  entityUrl: string
  signal: EntitySignal
  reason?: string
  payload?: unknown
}

function parseErrorResponse(text: string): string | null {
  if (!text) return null
  try {
    const data = JSON.parse(text) as {
      error?: { message?: unknown }
      message?: unknown
    }
    if (typeof data.error?.message === `string`) return data.error.message
    if (typeof data.message === `string`) return data.message
  } catch {
    // Keep the raw response text below.
  }
  return text
}

function compactToastText(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > 360 ? `${trimmed.slice(0, 357)}...` : trimmed
}

function showSignalFailureToast(input: {
  action: `kill` | `signal`
  entityUrl: string
  signal: EntitySignal
  status?: number
  responseText?: string
  error?: unknown
}): void {
  const title = input.action === `kill` ? `Kill failed` : `Signal failed`
  const status = input.status ? ` (${input.status})` : ``
  const parsed =
    input.responseText !== undefined
      ? parseErrorResponse(input.responseText)
      : input.error instanceof Error
        ? input.error.message
        : input.error
          ? String(input.error)
          : null
  const details = parsed ? compactToastText(parsed) : `No response details.`
  showToast({
    tone: `danger`,
    title: `${title}${status}`,
    description: `${input.signal} to ${input.entityUrl}: ${details}`,
  })
}

function showForkFailureToast(input: {
  entityUrl: string
  status?: number
  responseText?: string
  error?: unknown
}): void {
  const status = input.status ? ` (${input.status})` : ``
  const parsed =
    input.responseText !== undefined
      ? parseErrorResponse(input.responseText)
      : input.error instanceof Error
        ? input.error.message
        : input.error
          ? String(input.error)
          : null
  const details = parsed ? compactToastText(parsed) : `No response details.`
  showToast({
    tone: `danger`,
    title: `Fork failed${status}`,
    description: `${input.entityUrl}: ${details}`,
  })
}

function createSpawnAction(
  baseUrl: string,
  entitiesCollection: EntitiesCollection
) {
  return createOptimisticAction<SpawnInput>({
    onMutate: ({ type, name, tags, args, sandbox, dispatch_policy }) => {
      entitiesCollection.insert({
        url: `/${type}/${name}`,
        type,
        status: `spawning`,
        tags: tags ?? {},
        spawn_args: args ?? {},
        sandbox: sandbox ?? null,
        // Mirror the pinned runner optimistically so the runner badge shows
        // immediately on spawn rather than after the first server sync.
        dispatch_policy: dispatch_policy ?? null,
        parent: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
    },
    mutationFn: async ({
      type,
      name,
      args,
      tags,
      parent,
      initialMessage,
      initialMessageType,
      dispatch_policy,
      sandbox,
    }) => {
      const body: Record<string, unknown> = {}
      if (args) body.args = args
      if (tags) body.tags = tags
      if (parent) body.parent = parent
      if (initialMessage) body.initialMessage = initialMessage
      if (initialMessageType) body.initialMessageType = initialMessageType
      if (dispatch_policy) body.dispatch_policy = dispatch_policy
      if (sandbox) body.sandbox = sandbox

      const res = await serverFetch(entitySpawnApiUrl(baseUrl, type, name), {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => ``)
        let message = `Spawn failed (${res.status})`
        try {
          const data = JSON.parse(text) as Record<string, unknown>
          if (data.message) {
            message = String(data.message)
          } else if (
            typeof data.error === `object` &&
            data.error !== null &&
            `message` in data.error
          ) {
            message = String(data.error.message)
          }
        } catch {
          if (text) message = text
        }
        throw new Error(message)
      }
      const data = (await res.json()) as { txid: number }
      return { txid: data.txid }
    },
  })
}

function createKillAction(
  baseUrl: string,
  entitiesCollection: EntitiesCollection
) {
  return createOptimisticAction<string>({
    onMutate: (entityUrl) => {
      entitiesCollection.update(entityUrl, (draft) => {
        draft.status = `killed`
      })
    },
    mutationFn: async (entityUrl) => {
      const url = entityApiUrl(baseUrl, entityUrl, `/signal`)
      let res: Response
      try {
        res = await serverFetch(url, {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify({
            signal: `SIGKILL`,
            reason: `Killed from agents UI`,
          }),
        })
      } catch (err) {
        showSignalFailureToast({
          action: `kill`,
          entityUrl,
          signal: `SIGKILL`,
          error: err,
        })
        throw err
      }
      if (!res.ok) {
        const text = await res.text().catch(() => ``)
        showSignalFailureToast({
          action: `kill`,
          entityUrl,
          signal: `SIGKILL`,
          status: res.status,
          responseText: text,
        })
        throw new Error(text || `Kill failed (${res.status})`)
      }
      const data = (await res.json()) as { txid: number }
      return { txid: data.txid }
    },
  })
}

function optimisticStatusForSignal(
  status: EntityStatus,
  signal: EntitySignal
): EntityStatus | null {
  switch (signal) {
    case `SIGKILL`:
      return `killed`
    case `SIGINT`:
      return null
    case `SIGTERM`:
      if (status === `idle` || status === `paused`) return `stopped`
      if (status === `running`) return `stopping`
      return null
    case `SIGSTOP`:
      return status === `idle` || status === `running` ? `paused` : null
    case `SIGCONT`:
      return status === `paused` ? `idle` : null
    case `SIGHUP`:
    case `SIGUSR`:
      return null
  }
}

function createSignalAction(
  baseUrl: string,
  entitiesCollection: EntitiesCollection
) {
  return createOptimisticAction<SignalInput>({
    onMutate: ({ entityUrl, signal }) => {
      entitiesCollection.update(entityUrl, (draft) => {
        const optimisticStatus = optimisticStatusForSignal(draft.status, signal)
        if (optimisticStatus) {
          draft.status = optimisticStatus
        }
        draft.updated_at = Date.now()
      })
    },
    mutationFn: async ({ entityUrl, signal, reason, payload }) => {
      const body: Record<string, unknown> = { signal }
      if (reason !== undefined) body.reason = reason
      if (payload !== undefined) body.payload = payload

      const url = entityApiUrl(baseUrl, entityUrl, `/signal`)
      let res: Response
      try {
        res = await serverFetch(url, {
          method: `POST`,
          headers: { 'content-type': `application/json` },
          body: JSON.stringify(body),
        })
      } catch (err) {
        showSignalFailureToast({
          action: `signal`,
          entityUrl,
          signal,
          error: err,
        })
        throw err
      }
      if (!res.ok) {
        const text = await res.text().catch(() => ``)
        showSignalFailureToast({
          action: `signal`,
          entityUrl,
          signal,
          status: res.status,
          responseText: text,
        })
        throw new Error(text || `Signal failed (${res.status})`)
      }
      const data = (await res.json()) as { txid: number }
      return { txid: data.txid }
    },
  })
}

function createForkEntity(baseUrl: string) {
  return async (
    entityUrl: string,
    opts?: { pointer?: EventPointer }
  ): Promise<{ url: string }> => {
    // Wire convention is snake_case; in-code TS is camelCase.
    const body = opts?.pointer
      ? {
          fork_pointer: {
            offset: opts.pointer.offset,
            sub_offset: opts.pointer.subOffset,
          },
        }
      : {}
    const url = entityApiUrl(baseUrl, entityUrl, `/fork`)
    let res: Response
    try {
      res = await serverFetch(url, {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify(body),
      })
    } catch (err) {
      showForkFailureToast({ entityUrl, error: err })
      throw err
    }
    if (!res.ok) {
      const text = await res.text().catch(() => ``)
      showForkFailureToast({
        entityUrl,
        status: res.status,
        responseText: text,
      })
      const message = parseErrorResponse(text) ?? `Fork failed (${res.status})`
      throw new Error(message)
    }
    const data = (await res.json()) as { root?: { url?: string } }
    if (!data.root?.url) {
      const message = `Fork returned an invalid response`
      showForkFailureToast({ entityUrl, error: message })
      throw new Error(message)
    }
    return { url: data.root.url }
  }
}

// --- Context ---

interface ElectricAgentsState {
  entitiesCollection: EntitiesCollection | null
  entityTypesCollection: EntityTypesCollection | null
  runnersCollection: RunnersCollection | null
  spawnEntity: ReturnType<typeof createSpawnAction> | null
  signalEntity: ReturnType<typeof createSignalAction> | null
  killEntity: ReturnType<typeof createKillAction> | null
  forkEntity: ReturnType<typeof createForkEntity> | null
}

const ElectricAgentsContext = createContext<ElectricAgentsState>({
  entitiesCollection: null,
  entityTypesCollection: null,
  runnersCollection: null,
  spawnEntity: null,
  signalEntity: null,
  killEntity: null,
  forkEntity: null,
})

export function ElectricAgentsProvider({
  baseUrl,
  children,
}: {
  baseUrl: string | null
  children: ReactNode
}): React.ReactElement {
  const previousBaseUrlRef = useRef<string | null>(null)

  useEffect(() => {
    const previousBaseUrl = previousBaseUrlRef.current
    previousBaseUrlRef.current = baseUrl
    if (previousBaseUrl && previousBaseUrl !== baseUrl) {
      cleanupAppCollections(previousBaseUrl)
    }
    if (!baseUrl) cleanupAppCollectionsExcept(null)
  }, [baseUrl])

  const state = useMemo<ElectricAgentsState>(() => {
    if (!baseUrl) {
      return {
        entitiesCollection: null,
        entityTypesCollection: null,
        runnersCollection: null,
        spawnEntity: null,
        signalEntity: null,
        killEntity: null,
        forkEntity: null,
      }
    }

    const { entities, entityTypes, runners } =
      getOrCreateAppCollections(baseUrl)
    return {
      entitiesCollection: entities,
      entityTypesCollection: entityTypes,
      runnersCollection: runners,
      spawnEntity: createSpawnAction(baseUrl, entities),
      signalEntity: createSignalAction(baseUrl, entities),
      killEntity: createKillAction(baseUrl, entities),
      forkEntity: createForkEntity(baseUrl),
    }
  }, [baseUrl])

  return (
    <ElectricAgentsContext.Provider value={state}>
      {children}
    </ElectricAgentsContext.Provider>
  )
}

export function useElectricAgents(): ElectricAgentsState {
  return useContext(ElectricAgentsContext)
}
