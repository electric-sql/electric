import {
  createStreamDB,
  type CreateStreamDBOptions,
  type StreamDB,
} from '@durable-streams/state'
import { getObserveUrl } from '../api/agentsProxyApi'
import {
  actorIdSchema,
  livingWikiStateSchema,
  wikiSpaceIdSchema,
  type livingWikiStateCollections,
} from '../../shared/wiki-state'

export interface CreateLivingWikiStateDbInput {
  wikiSpaceId: string
  actorId?: string
}

export type LivingWikiStateDb = StreamDB<typeof livingWikiStateCollections>
export type LivingWikiStateDbCreateOptions = CreateStreamDBOptions<
  typeof livingWikiStateSchema
>

export interface CreateLivingWikiStateDbOptions {
  createStreamDB?: (options: LivingWikiStateDbCreateOptions) => unknown
}

export function createLivingWikiStateDb(
  input: CreateLivingWikiStateDbInput,
  options: CreateLivingWikiStateDbOptions = {}
): LivingWikiStateDb {
  const wikiSpaceId = wikiSpaceIdSchema.parse(input.wikiSpaceId)
  const actorId = input.actorId ? actorIdSchema.parse(input.actorId) : undefined
  const createDb = options.createStreamDB ?? createStreamDB

  return createDb({
    streamOptions: {
      url: getObserveUrl(
        { wikiSpaceId, observeKind: `shared-state` },
        actorId ? { actorId } : undefined
      ),
      contentType: `application/json`,
    },
    state: livingWikiStateSchema,
  }) as LivingWikiStateDb
}
