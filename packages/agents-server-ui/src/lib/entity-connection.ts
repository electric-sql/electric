import { createEntityStreamDB } from '@electric-ax/agents-runtime'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime'

function getMainStreamPath(entityUrl: string): string {
  return `${entityUrl}/main`
}

export async function connectEntityStream(opts: {
  baseUrl: string
  entityUrl: string
}): Promise<{ db: EntityStreamDBWithActions; close: () => void }> {
  const { baseUrl, entityUrl } = opts

  const res = await fetch(`${baseUrl}${entityUrl}`, {
    headers: { accept: `application/json` },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch entity at ${entityUrl}: ${res.statusText}`)
  }
  await res.body?.cancel()
  const streamUrl = `${baseUrl}${getMainStreamPath(entityUrl)}`
  const db = createEntityStreamDB(streamUrl)
  await db.preload()

  return { db, close: () => db.close() }
}
