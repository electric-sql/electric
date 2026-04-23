import { createStreamDB } from '@durable-streams/state'
import { createEntityStreamDB } from './entity-stream-db'
import { normalizeObservationSchema } from './observation-schema'
import { createRuntimeServerClient } from './runtime-server-client'
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
}

export interface AgentsClient {
  observe: (
    source: ObservationSource
  ) => Promise<EntityStreamDB | ObservationStreamDB>
}

export function createAgentsClient(config: AgentsClientConfig): AgentsClient {
  const serverClient = createRuntimeServerClient(config)

  return {
    async observe(source) {
      if (source.sourceType === `entity`) {
        const info = await serverClient.getEntityInfo(
          (source as EntityObservationSource).entityUrl
        )
        const db = createEntityStreamDB(`${config.baseUrl}${info.streamPath}`)
        await db.preload()
        return db
      }

      if (source.sourceType === `cron`) {
        throw new Error(
          `[agent-runtime] observe(cron(...)) is not yet supported. Use wake-based subscriptions for cron sources instead.`
        )
      }

      if (source.sourceType === `entities`) {
        await serverClient.registerEntitiesSource(
          (source as EntitiesObservationSource).tags
        )
      }

      if (!source.streamUrl || !source.schema) {
        throw new Error(
          `[agent-runtime] Cannot observe source "${source.sourceType}" without a streamUrl and schema`
        )
      }

      const db = createStreamDB({
        streamOptions: {
          url: `${config.baseUrl}${source.streamUrl}`,
          contentType: `application/json`,
        },
        state: normalizeObservationSchema(source.schema),
      })
      await db.preload()
      return db
    },
  }
}
