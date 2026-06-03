import { describe, expect, it } from 'vitest'
import { buildSourceSubmissionRows } from './wiki-state-sources'
import {
  buildWikiPageFromSubmittedSource,
  slugifyWikiPageTitle,
} from './wiki-state-pages'
import { wikiPageSchema } from './wiki-state'

const now = () => new Date(`2026-06-03T00:00:00.000Z`)

describe(`wiki-state-pages`, () => {
  it(`builds a validated text page proposal`, () => {
    const { source } = buildSourceSubmissionRows(
      {
        wikiSpaceId: `wiki_demo`,
        actorId: `actor_a`,
        kind: `text`,
        title: `Hello Wiki`,
        body: `Body text`,
      },
      { now }
    )
    const page = buildWikiPageFromSubmittedSource(source, { now })
    expect(wikiPageSchema.parse(page).status).toBe(`proposed`)
    expect(page.slug).toBe(`hello-wiki`)
    expect(page.body).toContain(`Body text`)
  })
  it(`builds a URL page proposal without fetching`, () => {
    const { source } = buildSourceSubmissionRows(
      {
        wikiSpaceId: `wiki_demo`,
        actorId: `actor_a`,
        kind: `url`,
        title: `Docs`,
        url: `https://example.com/a`,
      },
      { now }
    )
    const page = buildWikiPageFromSubmittedSource(source, { now })
    expect(page.body).toContain(`Source URL: https://example.com/a`)
    expect(page.body).toContain(`No URL fetch`)
  })
  it(`sanitizes slugs and rejects non-submitted sources`, () => {
    expect(slugifyWikiPageTitle(`  !!! `, `source_abc`)).toBe(`source-abc`)
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
    expect(() =>
      buildWikiPageFromSubmittedSource({ ...source, status: `rejected` })
    ).toThrow(/submitted/)
  })
})
