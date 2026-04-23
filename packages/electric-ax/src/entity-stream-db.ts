/**
 * Creates a StreamDB backed by an Electric Agents entity's main stream.
 *
 * Fetches entity details from the server, then creates typed, reactive
 * collections for all standard entity event types. Every event in an
 * entity stream is a proper State Protocol event ({type, key, value, headers}),
 * so we feed them directly to StreamDB without transformation.
 */

import { createStreamDB } from '@durable-streams/state'
import { entityStateSchema } from '@electric-ax/agent-runtime'
import type { EntityStreamDB } from '@electric-ax/agent-runtime'

export type { EntityStreamDB } from '@electric-ax/agent-runtime'

function getMainStreamPath(
  entityUrl: string,
  entity: { streams?: { main?: string } }
): string {
  return entity.streams?.main ?? `${entityUrl}/main`
}

// ============================================================================
// Main implementation
// ============================================================================

export async function createEntityStreamDB(opts: {
  baseUrl: string
  entityUrl: string
  initialOffset?: string
}): Promise<{ db: EntityStreamDB; close: () => void }> {
  const { baseUrl, entityUrl, initialOffset } = opts

  console.log(
    `[createEntityStreamDB] Creating entity stream DB for ${baseUrl}${entityUrl}`
  )

  let res: Response
  try {
    res = await fetch(`${baseUrl}${entityUrl}`, {
      headers: { 'content-type': `application/json` },
    })
  } catch (err) {
    throw new Error(
      `Could not connect to the Electric Agents server at ${baseUrl} — is it running?\n  ${err instanceof Error ? err.message : String(err)}`
    )
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch entity at ${entityUrl}: ${res.statusText}`)
  }
  const entity = (await res.json()) as {
    streams?: { main: string; error: string }
  }
  const streamPath = getMainStreamPath(entityUrl, entity)
  const streamUrl = `${baseUrl}${streamPath}`

  const db = createStreamDB({
    streamOptions: {
      url: streamUrl,
      contentType: `application/json`,
      ...(initialOffset ? { offset: initialOffset } : {}),
    },
    state: entityStateSchema,
  })

  await db.preload()

  return { db: db as unknown as EntityStreamDB, close: () => db.close() }
}
