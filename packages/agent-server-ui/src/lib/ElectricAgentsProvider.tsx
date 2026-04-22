import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { createCollection } from '@tanstack/react-db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { createOptimisticAction } from '@tanstack/db'
import { z } from 'zod'
import type { ReactNode } from 'react'

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

function createEntityTypesCollection(baseUrl: string) {
  return createCollection(
    electricCollectionOptions({
      id: `entity-types`,
      schema: entityTypeSchema,
      shapeOptions: {
        url: `${baseUrl}/_electric/electric/v1/shape`,
        params: { table: `entity_types` },
      },
      getKey: (item) => item.name,
    })
  )
}

type EntitiesCollection = ReturnType<typeof createEntitiesCollection>
type EntityTypesCollection = ReturnType<typeof createEntityTypesCollection>

// --- Actions ---

interface SpawnInput {
  type: string
  name: string
  args?: Record<string, unknown>
  tags?: Record<string, string>
  parent?: string
  initialMessage?: unknown
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
        tags: tags ?? {},
        spawn_args: args ?? {},
        parent: null,
        created_at: Date.now(),
        updated_at: Date.now(),
      })
    },
    mutationFn: async ({ type, name, args, tags, parent, initialMessage }) => {
      const body: Record<string, unknown> = {}
      if (args) body.args = args
      if (tags) body.tags = tags
      if (parent) body.parent = parent
      if (initialMessage) body.initialMessage = initialMessage

      const res = await fetch(`${baseUrl}/${type}/${name}`, {
        method: `PUT`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => ``)
        let message = `Spawn failed (${res.status})`
        try {
          const data = JSON.parse(text) as Record<string, unknown>
          if (data.message) message = String(data.message)
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
      const res = await fetch(`${baseUrl}${entityUrl}`, {
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

// --- Context ---

interface ElectricAgentsState {
  entitiesCollection: EntitiesCollection | null
  entityTypesCollection: EntityTypesCollection | null
  spawnEntity: ReturnType<typeof createSpawnAction> | null
  killEntity: ReturnType<typeof createKillAction> | null
}

const ElectricAgentsContext = createContext<ElectricAgentsState>({
  entitiesCollection: null,
  entityTypesCollection: null,
  spawnEntity: null,
  killEntity: null,
})

export function ElectricAgentsProvider({
  baseUrl,
  children,
}: {
  baseUrl: string | null
  children: ReactNode
}): React.ReactElement {
  const [state, setState] = useState<ElectricAgentsState>({
    entitiesCollection: null,
    entityTypesCollection: null,
    spawnEntity: null,
    killEntity: null,
  })
  const prevUrlRef = useRef<string | null>(null)
  const collectionsRef = useRef<{
    entities: EntitiesCollection | null
    entityTypes: EntityTypesCollection | null
  }>({ entities: null, entityTypes: null })

  useEffect(() => {
    if (baseUrl === prevUrlRef.current) return
    prevUrlRef.current = baseUrl

    // Clean up old collections to stop SSE streams
    collectionsRef.current.entities?.cleanup()
    collectionsRef.current.entityTypes?.cleanup()
    collectionsRef.current = { entities: null, entityTypes: null }

    if (!baseUrl) {
      setState({
        entitiesCollection: null,
        entityTypesCollection: null,
        spawnEntity: null,
        killEntity: null,
      })
      return
    }

    const entities = createEntitiesCollection(baseUrl)
    const entityTypes = createEntityTypesCollection(baseUrl)

    collectionsRef.current = { entities, entityTypes }

    setState({
      entitiesCollection: entities,
      entityTypesCollection: entityTypes,
      spawnEntity: createSpawnAction(baseUrl, entities),
      killEntity: createKillAction(baseUrl, entities),
    })

    return () => {
      collectionsRef.current.entities?.cleanup()
      collectionsRef.current.entityTypes?.cleanup()
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
