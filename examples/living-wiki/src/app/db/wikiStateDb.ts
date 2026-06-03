import {
  createStreamDB,
  type CreateStreamDBOptions,
  type StreamDB,
} from '@durable-streams/state'
import { getObserveUrl } from '../api/agentsProxyApi'
import {
  livingWikiStateSchema,
  wikiSpaceIdSchema,
  type livingWikiStateCollections,
} from '../../shared/wiki-state'

export interface CreateLivingWikiStateDbInput {
  wikiSpaceId: string
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
  const createDb = options.createStreamDB ?? createStreamDB

  return createDb({
    streamOptions: {
      url: getObserveUrl({ wikiSpaceId, observeKind: `shared-state` }),
      contentType: `application/json`,
    },
    state: livingWikiStateSchema,
  }) as LivingWikiStateDb
}
