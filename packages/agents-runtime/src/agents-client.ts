import { createStreamDB } from '@durable-streams/state/db'
import { createEntityStreamDB } from './entity-stream-db'
import { normalizeObservationSchema } from './observation-schema'
import { createRuntimeServerClient } from './runtime-server-client'
import { appendPathToUrl } from './url'
import type { EntitySignal } from './runtime-server-client'
import type {
  EntitiesObservationSource,
  EntityObservationSource,
} from './observation-sources'
import type {
  EntityStreamDB,
  ObservationSource,
  ObservationStreamDB,
} from './types'

export interface AgentsClientConfig {
  baseUrl: string
  fetch?: typeof globalThis.fetch
  principalKey?: string
}

export interface AgentsClient {
  observe: (
    source: ObservationSource
  ) => Promise<EntityStreamDB | ObservationStreamDB>
  signal: (options: {
    entityUrl: string
    signal: EntitySignal
    reason?: string
    payload?: unknown
  }) => Promise<{ txid: number }>
  kill: (entityUrl: string, reason?: string) => Promise<{ txid: number }>
}

export function createAgentsClient(config: AgentsClientConfig): AgentsClient {
  const serverClient = createRuntimeServerClient(config)

  return {
    signal: (options) => serverClient.signalEntity(options),
    kill: (entityUrl, reason) =>
      serverClient.signalEntity({
        entityUrl,
        signal: `SIGKILL`,
        reason,
      }),
    async observe(source) {
      if (source.sourceType === `entity`) {
        const info = await serverClient.getEntity(
          (source as EntityObservationSource).entityUrl
        )
        const db = createEntityStreamDB(
          appendPathToUrl(config.baseUrl, info.streamPath)
        )
        await db.preload()
        return db
      }

      if (source.sourceType === `cron`) {
        throw new Error(
          `[agent-runtime] observe(cron(...)) is not yet supported. Use wake-based subscriptions for cron sources instead.`
        )
      }

      if (source.sourceType === `entities`) {
        const ensured = await serverClient.ensureEntitiesMembershipStream(
          (source as EntitiesObservationSource).tags
        )
        source = {
          ...source,
          sourceRef: ensured.sourceRef,
          streamUrl: ensured.streamUrl,
        }
      }

      if (!source.streamUrl || !source.schema) {
        throw new Error(
          `[agent-runtime] Cannot observe source "${source.sourceType}" without a streamUrl and schema`
        )
      }

      if (source.ensureStream) {
        await serverClient.ensureStream(
          source.streamUrl,
          source.ensureStream.contentType
        )
      }

      const db = createStreamDB({
        streamOptions: {
          url: appendPathToUrl(config.baseUrl, source.streamUrl),
          contentType: `application/json`,
        },
        state: normalizeObservationSchema(source.schema),
      })
      await db.preload()
      return db
    },
  }
}
