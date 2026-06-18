/**
 * Creates a StreamDB backed by an Electric Agents entity's main stream.
 *
 * Fetches entity details from the server, then creates typed, reactive
 * collections for all standard entity event types. Every event in an
 * entity stream is a proper State Protocol event ({type, key, value, headers}),
 * so we feed them directly to StreamDB without transformation.
 */

import {
  appendPathToUrl,
  createEntityStreamDB as createRuntimeEntityStreamDB,
} from '@electric-ax/agents-runtime'
import { entityApiUrl } from './entity-api.js'
import type { EntityStreamDB } from '@electric-ax/agents-runtime'

export type { EntityStreamDB } from '@electric-ax/agents-runtime'

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
  headers?: Record<string, string>
}): Promise<{ db: EntityStreamDB; close: () => void }> {
  const { baseUrl, entityUrl, initialOffset, headers: serverHeaders } = opts

  const requestHeaders = {
    'content-type': `application/json`,
    ...serverHeaders,
  }

  let res: Response
  try {
    res = await fetch(entityApiUrl(baseUrl, entityUrl), {
      headers: requestHeaders,
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
    streams?: { main: string }
  }
  const streamPath = getMainStreamPath(entityUrl, entity)
  const streamUrl = appendPathToUrl(baseUrl, streamPath)

  const db = createRuntimeEntityStreamDB(streamUrl, undefined, undefined, {
    streamOptions: {
      headers: requestHeaders,
      ...(initialOffset ? { offset: initialOffset } : {}),
    },
  })

  await db.preload()

  return { db: db as unknown as EntityStreamDB, close: () => db.close() }
}
