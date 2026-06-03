import type { EntityRegistry } from '@electric-ax/agents-runtime'
import { z } from 'zod'

import {
  livingWikiStateCollections,
  wikiSpaceIdSchema,
} from '../../shared/wiki-state'
import { deriveLivingWikiSharedStateId } from '../../shared/wiki-state-ids'

export const WIKI_SPACE_ENTITY_TYPE = `wiki_space` as const

export const wikiSpaceCreationSchema = z
  .object({
    wikiSpaceId: wikiSpaceIdSchema,
  })
  .strict()

export const wikiSpaceArgsSchema = wikiSpaceCreationSchema

export type WikiSpaceCreationArgs = z.infer<typeof wikiSpaceCreationSchema>

export type WikiSpaceRuntimeIds = {
  readonly wikiSpaceId: string
  readonly entityUrl: string
  readonly sharedStateId: string
}

export function getWikiSpaceRuntimeIds(
  wikiSpaceId: WikiSpaceCreationArgs[`wikiSpaceId`]
): WikiSpaceRuntimeIds {
  return {
    wikiSpaceId,
    entityUrl: `/${WIKI_SPACE_ENTITY_TYPE}/${wikiSpaceId}`,
    sharedStateId: deriveLivingWikiSharedStateId(wikiSpaceId),
  }
}

export function registerWikiSpace(registry: EntityRegistry): void {
  registry.define(WIKI_SPACE_ENTITY_TYPE, {
    description: `Living Wiki space coordinator scaffold. Inert in this phase: registers shared-state identity only, without orchestration or writes.`,
    creationSchema: wikiSpaceCreationSchema,
    async handler(ctx) {
      const { sharedStateId } = getWikiSpaceRuntimeIds(ctx.args.wikiSpaceId)

      if (ctx.firstWake) {
        ctx.mkdb(sharedStateId, livingWikiStateCollections)
      }

      ctx.sleep()
    },
  })
}
