import { useState, useEffect } from 'react'
import {
  createAgentsClient,
  createEntityStreamDB,
  entities,
  db,
} from '@electric-ax/agents-runtime'
import { createEffect, type Collection } from '@tanstack/db'
import {
  swarmSharedSchema,
  type WikiEntry,
  type Xref,
} from '../../server/schema.js'

async function connectEntityStream(opts: {
  baseUrl: string
  entityUrl: string
}) {
  const streamUrl = `${opts.baseUrl}${opts.entityUrl}/main`
  const orchDb = createEntityStreamDB(streamUrl)
  await orchDb.preload()
  return { db: orchDb, close: () => orchDb.close() }
}

interface EntityMember {
  url: string
  type: string
  status: string
  tags: Record<string, string>
  spawn_args: Record<string, unknown>
  parent: string | null
  created_at: number
  updated_at: number
}

export interface SwarmAgent {
  url: string
  name: string
  status: string
  topic: string
  parent: string | null
  createdAt: number
  updatedAt: number
  isOrchestrator: boolean
}

function agentNameFromUrl(url: string): string {
  const parts = url.split(`/`).filter(Boolean)
  return parts[parts.length - 1] ?? url
}

export function useSwarm(darixUrl: string | null, swarmId: string | null) {
  const [agents, setAgents] = useState<SwarmAgent[]>([])
  const [wiki, setWiki] = useState<WikiEntry[]>([])
  const [xrefs, setXrefs] = useState<Xref[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!darixUrl || !swarmId) return

    let cancelled = false
    const cleanups: Array<() => void> = []

    async function connect() {
      try {
        const client = createAgentsClient({ baseUrl: darixUrl! })

        // 1. Observe entities by tag for spawn/status events
        const entitiesDb = await client.observe(
          entities({ tags: { swarm_id: swarmId! } })
        )
        const members = (entitiesDb as any).collections
          .members as Collection<EntityMember>

        const agentMap = new Map<string, SwarmAgent>()

        const entitiesEffect = createEffect({
          query: (q) => q.from({ m: members }),
          onEnter: (event) => {
            const m = event.value as unknown as EntityMember
            agentMap.set(m.url, {
              url: m.url,
              name: agentNameFromUrl(m.url),
              status: m.status,
              topic: m.tags.topic ?? ``,
              parent: m.parent ?? null,
              createdAt: m.created_at,
              updatedAt: m.updated_at,
              isOrchestrator: m.type === `orchestrator`,
            })
            if (!cancelled) setAgents(Array.from(agentMap.values()))
          },
          onUpdate: (event) => {
            const m = event.value as unknown as EntityMember
            const existing = agentMap.get(m.url)
            if (existing) {
              existing.status = m.status
              existing.updatedAt = m.updated_at
              if (!cancelled) setAgents(Array.from(agentMap.values()))
            }
          },
        })
        cleanups.push(() => entitiesEffect.dispose())

        // 2. Observe the orchestrator entity stream — wait for its
        //    shared-state manifest before subscribing to the shared DB.
        //    This avoids a race where the frontend tries to observe a
        //    shared state stream that hasn't been created yet (the
        //    orchestrator's first wake calls ctx.mkdb()).
        const orchUrl = `/orchestrator/${swarmId!}`
        const orchStream = await connectEntityStream({
          baseUrl: darixUrl!,
          entityUrl: orchUrl,
        })
        cleanups.push(() => orchStream.close())

        const orchManifests = orchStream.db.collections.manifests

        let sharedDbCleanup: (() => void) | null = null

        const manifestEffect = createEffect({
          query: (q) => q.from({ m: orchManifests }),
          onEnter: async (event) => {
            const m = event.value as any
            if (m.kind !== `shared-state` || sharedDbCleanup) return
            if (cancelled) return

            try {
              const sharedDb = await client.observe(db(m.id, swarmSharedSchema))
              sharedDbCleanup = () => sharedDb.close()
              cleanups.push(sharedDbCleanup)
              if (cancelled) return

              const wikiCollection = (sharedDb as any).collections
                .wiki as Collection<WikiEntry>
              const xrefCollection = (sharedDb as any).collections
                .xrefs as Collection<Xref>

              const wikiEffect = createEffect({
                query: (q) => q.from({ w: wikiCollection }),
                onEnter: () => {
                  const entries = Array.from(
                    wikiCollection.values()
                  ) as WikiEntry[]
                  if (!cancelled) setWiki(entries)
                },
                onUpdate: () => {
                  const entries = Array.from(
                    wikiCollection.values()
                  ) as WikiEntry[]
                  if (!cancelled) setWiki(entries)
                },
              })
              cleanups.push(() => wikiEffect.dispose())

              const xrefEffect = createEffect({
                query: (q) => q.from({ x: xrefCollection }),
                onEnter: () => {
                  const entries = Array.from(xrefCollection.values()) as Xref[]
                  if (!cancelled) setXrefs(entries)
                },
                onUpdate: () => {
                  const entries = Array.from(xrefCollection.values()) as Xref[]
                  if (!cancelled) setXrefs(entries)
                },
              })
              cleanups.push(() => xrefEffect.dispose())
            } catch (err) {
              if (!cancelled) {
                setError(
                  `Shared state: ${err instanceof Error ? err.message : String(err)}`
                )
                setConnected(false)
              }
            }
          },
          onError: (err) => {
            if (!cancelled) {
              setError(
                `Manifest error: ${err instanceof Error ? err.message : String(err)}`
              )
            }
          },
        })
        cleanups.push(() => manifestEffect.dispose())

        if (!cancelled) {
          setConnected(true)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setConnected(false)
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      for (const cleanup of cleanups) cleanup()
    }
  }, [darixUrl, swarmId])

  return { agents, wiki, xrefs, connected, error }
}
