import { createEntityStreamDB } from '@electric-ax/agents-runtime'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime'

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
}): Promise<{ db: EntityStreamDBWithActions; close: () => void }> {
  const { baseUrl, entityUrl, customState } = opts

  const res = await fetch(`${baseUrl}${entityUrl}`, {
    headers: { accept: `application/json` },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch entity at ${entityUrl}: ${res.statusText}`)
  }
  await res.body?.cancel()
  const streamUrl = `${baseUrl}${getMainStreamPath(entityUrl)}`
  const db = createEntityStreamDB(
    streamUrl,
    customState as unknown as Parameters<typeof createEntityStreamDB>[1]
  )
  await db.preload()

  return { db, close: () => db.close() }
}
