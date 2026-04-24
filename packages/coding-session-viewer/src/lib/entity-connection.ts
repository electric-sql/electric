import { createEntityStreamDB } from '@electric-ax/agents-runtime'
import type { EntityStreamDBWithActions } from '@electric-ax/agents-runtime'

/**
 * The `coding-session` entity's custom state collections. Must match the
 * definition in `packages/agents/src/agents/coding-session.ts` — collection
 * names + event types are part of that entity's public contract. Kept in
 * sync by hand.
 */
export const CODING_SESSION_STATE = {
  sessionMeta: { type: `coding_session_meta`, primaryKey: `key` },
  cursorState: { type: `coding_session_cursor`, primaryKey: `key` },
  events: { type: `coding_session_event`, primaryKey: `key` },
} as const

function getMainStreamPath(entityUrl: string): string {
  return `${entityUrl}/main`
}

export async function connectCodingSession(opts: {
  baseUrl: string
  entityUrl: string
}): Promise<{ db: EntityStreamDBWithActions; close: () => void }> {
  const { baseUrl, entityUrl } = opts

  const res = await fetch(`${baseUrl}${entityUrl}`, {
    headers: { accept: `application/json` },
  })
  if (!res.ok) {
    throw new Error(
      `Failed to fetch entity at ${entityUrl}: ${res.status} ${res.statusText}`
    )
  }
  await res.body?.cancel()
  const streamUrl = `${baseUrl}${getMainStreamPath(entityUrl)}`
  const db = createEntityStreamDB(
    streamUrl,
    CODING_SESSION_STATE as unknown as Parameters<
      typeof createEntityStreamDB
    >[1]
  )
  await db.preload()
  return { db, close: () => db.close() }
}
