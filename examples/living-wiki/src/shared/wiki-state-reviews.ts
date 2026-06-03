import { z } from 'zod'

import {
  reviewItemSchema,
  sourceSchema,
  wikiPageSchema,
  type ReviewItemRow,
  type SourceRow,
  type WikiPageRow,
} from './wiki-state'
import { createReviewItemId } from './wiki-state-ids'

export const resolveReviewItemCommandSchema = z.object({
  wikiSpaceId: z.string().regex(/^wiki_[a-z0-9_-]+$/),
  actorId: z.string().regex(/^actor_[a-z0-9_-]+$/),
  reviewItemId: z.string().regex(/^review_[a-z0-9_-]+$/),
  resolution: z.enum([`approve`, `reject`]),
  note: z.string().trim().min(1).max(1000).optional(),
})
export type ResolveReviewItemCommand = z.input<
  typeof resolveReviewItemCommandSchema
>

export function buildOpenReviewItemForPage(
  pageInput: WikiPageRow,
  sourceInput: SourceRow,
  options: { now?: () => Date; reviewSeed?: string } = {}
): ReviewItemRow {
  const page = wikiPageSchema.parse(pageInput)
  const source = sourceSchema.parse(sourceInput)
  const now = (options.now?.() ?? new Date()).toISOString()
  return reviewItemSchema.parse({
    id: createReviewItemId(
      options.reviewSeed ?? `${page.wiki_space_id}-${page.id}`
    ),
    wiki_space_id: page.wiki_space_id,
    kind: `page`,
    status: `open`,
    target_type: `wiki_page`,
    target_id: page.id,
    suggested_change: `Review proposed page: ${page.title}`,
    rationale: `Created from submitted ${source.kind} source ${source.id}; no fetch, digest, or AI generation was performed.`,
    created_at: now,
    created_by_run_id: null,
    resolved_at: null,
    resolved_by_actor_id: null,
    resolution_note: null,
  })
}
