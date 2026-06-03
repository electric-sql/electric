import { describe, expect, it } from 'vitest'
import { buildSourceSubmissionRows } from './wiki-state-sources'
import { buildWikiPageFromSubmittedSource } from './wiki-state-pages'
import { buildOpenReviewItemForPage } from './wiki-state-reviews'
import { reviewItemSchema } from './wiki-state'

const now = () => new Date(`2026-06-03T00:00:00.000Z`)

describe(`wiki-state-reviews`, () => {
  it(`builds a valid deterministic open page review`, () => {
    const { source } = buildSourceSubmissionRows(
      {
        wikiSpaceId: `wiki_demo`,
        actorId: `actor_a`,
        kind: `text`,
        title: `T`,
        body: `B`,
      },
      { now }
    )
    const page = buildWikiPageFromSubmittedSource(source, { now })
    const review = buildOpenReviewItemForPage(page, source, { now })
    expect(reviewItemSchema.parse(review).status).toBe(`open`)
    expect(review.target_id).toBe(page.id)
    expect(buildOpenReviewItemForPage(page, source, { now }).id).toBe(review.id)
  })
})
