import {
  createEntityStreamDB,
  getSharedStateStreamPath,
} from '@electric-ax/agents-runtime'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime'
import type { PublicEntity } from './types'

function getMainStreamPath(entityUrl: string): string {
  return `${entityUrl}/main`
}

/**
 * Entity-side custom state collections to register on the UI-side
 * StreamDB so `db.collections[name]` resolves. Shape matches
 * `EntityDefinition['state']` — type + primaryKey are the minimum
 * needed; schema defaults to passthrough on the read side.
 */
export type UICustomState = Record<string, { type: string; primaryKey: string }>

export async function connectEntityStream(opts: {
  baseUrl: string
  entityUrl: string
  customState?: UICustomState
}): Promise<{
  db: EntityStreamDBWithActions
  entity: PublicEntity
  close: () => void
}> {
  const { baseUrl, entityUrl, customState } = opts

  const res = await fetch(`${baseUrl}${entityUrl}`, {
    headers: { accept: `application/json` },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch entity at ${entityUrl}: ${res.statusText}`)
  }
  const entity = (await res.json()) as PublicEntity
  const streamUrl = `${baseUrl}${getMainStreamPath(entityUrl)}`
  const db = createEntityStreamDB(
    streamUrl,
    customState as unknown as Parameters<typeof createEntityStreamDB>[1]
  )
  await db.preload()

  return { db, entity, close: () => db.close() }
}

/**
 * Connect to a shared-state (resource) stream. Used by views that
 * follow a resource pointer published as a tag on a wrapper entity —
 * e.g. the coder UI hook reads its `coderResource` tag and attaches
 * here for the session history. The schema mapping follows the same
 * `UICustomState` shape as the entity-side connection.
 *
 * Retries on 404 with bounded backoff. Reason: the shared-state
 * stream is only registered on the server *after* the wrapper
 * entity's first wake calls `mkdb`. The UI can race ahead of that
 * — user clicks the new coder in the sidebar before the builtin
 * server has finished its first-wake handler — and would otherwise
 * see "Stream not found" until they manually reload. The retry
 * window covers that race; if the resource genuinely doesn't exist
 * the final error still surfaces.
 */
export async function connectSharedStateStream(opts: {
  baseUrl: string
  resourceId: string
  customState: UICustomState
  retryMs?: number
  maxAttempts?: number
}): Promise<{ db: EntityStreamDBWithActions; close: () => void }> {
  const {
    baseUrl,
    resourceId,
    customState,
    retryMs = 250,
    maxAttempts = 20,
  } = opts
  const streamUrl = `${baseUrl}${getSharedStateStreamPath(resourceId)}`
  let lastErr: unknown = undefined
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const db = createEntityStreamDB(
      streamUrl,
      customState as unknown as Parameters<typeof createEntityStreamDB>[1]
    )
    try {
      await db.preload()
      return { db, close: () => db.close() }
    } catch (err) {
      db.close()
      lastErr = err
      const code = (err as { code?: string } | null)?.code
      const status = (err as { status?: number } | null)?.status
      const isNotFound = code === `NOT_FOUND` || status === 404
      if (!isNotFound) throw err
      // Linear backoff — the race window is short (the entity's
      // first-wake handler runs within a few hundred ms of spawn),
      // and exponential backoff would over-wait the common case.
      await new Promise((r) => setTimeout(r, retryMs))
    }
  }
  throw lastErr ?? new Error(`Failed to connect shared-state stream`)
}
