import { createContext, useContext, useEffect, useMemo, useRef } from 'react'
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { createOptimisticAction } from '@tanstack/db'
import { z } from 'zod'
import { appendPathToUrl } from '@electric-ax/agents-runtime/client'
import type { ReactNode } from 'react'
import { serverFetch } from './auth-fetch'
import {
  getCachedDesktopFormattedAssertedIdentity,
  getDesktopFormattedAssertedIdentity,
} from './assertedIdentity'
import { entityApiUrl, entitySpawnApiUrl } from './entity-api'

type EntityStatus = `spawning` | `running` | `idle` | `stopped`

// --- Schemas ---

const ENTITY_STATUSES: [EntityStatus, ...Array<EntityStatus>] = [
  `spawning`,
  `running`,
  `idle`,
  `stopped`,
]

const entitySchema = z.object({
  url: z.string(),
  type: z.string(),
  status: z.enum(ENTITY_STATUSES),
  tags: z.record(z.string()).default({}),
  spawn_args: z.record(z.unknown()).default({}),
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
  serve_endpoint: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
})

export type ElectricEntity = z.infer<typeof entitySchema>
export type ElectricEntityType = z.infer<typeof entityTypeSchema>

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

type EntitiesCollection = ReturnType<typeof createEntitiesCollection>
type EntityTypesCollection = ReturnType<typeof createEntityTypesCollection>

type AppCollections = {
  entities: EntitiesCollection
  entityTypes: EntityTypesCollection
}

const appCollectionsCache = new Map<string, AppCollections>()

function getOrCreateAppCollections(baseUrl: string): AppCollections {
  const cached = appCollectionsCache.get(baseUrl)
  if (cached) return cached
  const collections = {
    entities: createEntitiesCollection(baseUrl),
    entityTypes: createEntityTypesCollection(baseUrl),
  }
  appCollectionsCache.set(baseUrl, collections)
  return collections
}

function cleanupAppCollections(baseUrl: string): void {
  const collections = appCollectionsCache.get(baseUrl)
  if (!collections) return
  collections.entities.cleanup()
  collections.entityTypes.cleanup()
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
  dispatch_policy?: RunnerDispatchPolicy
}

function withCreatedByTag(
  tags: Record<string, string> | undefined,
  createdBy = getCachedDesktopFormattedAssertedIdentity()
): Record<string, string> | undefined {
  if (!createdBy) return tags
  return { ...(tags ?? {}), created_by: createdBy }
}

async function withCreatedByTagAsync(
  tags: Record<string, string> | undefined
): Promise<Record<string, string> | undefined> {
  return withCreatedByTag(tags, await getDesktopFormattedAssertedIdentity())
}

function createSpawnAction(
  baseUrl: string,
  entitiesCollection: EntitiesCollection
) {
  return createOptimisticAction<SpawnInput>({
    onMutate: ({ type, name, tags, args }) => {
      entitiesCollection.insert({
        url: `/${type}/${name}`,
        type,
        status: `spawning`,
        tags: withCreatedByTag(tags) ?? {},
        spawn_args: args ?? {},
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
      dispatch_policy,
    }) => {
      const body: Record<string, unknown> = {}
      const stampedTags = await withCreatedByTagAsync(tags)
      if (args) body.args = args
      if (stampedTags) body.tags = stampedTags
      if (parent) body.parent = parent
      if (initialMessage) body.initialMessage = initialMessage
      if (dispatch_policy) body.dispatch_policy = dispatch_policy

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
        draft.status = `stopped`
      })
    },
    mutationFn: async (entityUrl) => {
      const res = await serverFetch(entityApiUrl(baseUrl, entityUrl), {
        method: `DELETE`,
      })
      if (!res.ok) {
        const text = await res.text().catch(() => ``)
        throw new Error(text || `Kill failed (${res.status})`)
      }
      const data = (await res.json()) as { txid: number }
      return { txid: data.txid }
    },
  })
}

function createForkEntity(baseUrl: string) {
  return async (entityUrl: string): Promise<{ url: string }> => {
    const res = await serverFetch(entityApiUrl(baseUrl, entityUrl, `/fork`), {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({}),
    })
    if (!res.ok) {
      const text = await res.text().catch(() => ``)
      let message = text || `Fork failed (${res.status})`
      try {
        const data = JSON.parse(text) as {
          error?: { message?: string }
          message?: string
        }
        message = data.error?.message ?? data.message ?? message
      } catch {
        // Keep the raw response text.
      }
      throw new Error(message)
    }
    const data = (await res.json()) as { root?: { url?: string } }
    if (!data.root?.url) {
      throw new Error(`Fork returned an invalid response`)
    }
    return { url: data.root.url }
  }
}

// --- Context ---

interface ElectricAgentsState {
  entitiesCollection: EntitiesCollection | null
  entityTypesCollection: EntityTypesCollection | null
  spawnEntity: ReturnType<typeof createSpawnAction> | null
  killEntity: ReturnType<typeof createKillAction> | null
  forkEntity: ReturnType<typeof createForkEntity> | null
}

const ElectricAgentsContext = createContext<ElectricAgentsState>({
  entitiesCollection: null,
  entityTypesCollection: null,
  spawnEntity: null,
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
        spawnEntity: null,
        killEntity: null,
        forkEntity: null,
      }
    }

    const { entities, entityTypes } = getOrCreateAppCollections(baseUrl)
    return {
      entitiesCollection: entities,
      entityTypesCollection: entityTypes,
      spawnEntity: createSpawnAction(baseUrl, entities),
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
