import { describe, expect, it } from 'vitest'
import { resolveObserveTarget } from '../worker/agents-proxy/targets'
import {
  ACTIVITY_EVENT_ID_PREFIX,
  ACTOR_ID_PREFIX,
  AGENT_RUN_ID_PREFIX,
  MEMBERSHIP_ID_PREFIX,
  REVIEW_ITEM_ID_PREFIX,
  SOURCE_ID_PREFIX,
  WIKI_LINK_ID_PREFIX,
  WIKI_PAGE_ID_PREFIX,
  WIKI_SPACE_ID_PREFIX,
  createActivityEventId,
  createActorId,
  createAgentRunId,
  createMembershipId,
  createReviewItemId,
  createSourceId,
  createWikiLinkId,
  createWikiPageId,
  createWikiSpaceId,
  deriveLivingWikiSharedStateId,
  nowIsoTimestamp,
} from './wiki-state-ids'

const urlSafeIdPattern = /^[a-z0-9_-]+$/

describe(`living wiki state id helpers`, () => {
  it(`creates deterministic sanitized ids from seeds`, () => {
    expect(createWikiSpaceId(`Demo Space/One!`)).toBe(`wiki_demo-space-one`)
    expect(createActorId(`Ada Lovelace`)).toBe(`actor_ada-lovelace`)
    expect(createSourceId(`https://example.com/A Path?x=1`)).toBe(
      `source_https-example-com-a-path-x-1`
    )
    expect(createWikiPageId(`Getting Started`)).toBe(`page_getting-started`)
    expect(createReviewItemId(`Page:Intro`)).toBe(`review_page-intro`)
    expect(createActivityEventId(`Source submitted`)).toBe(
      `event_source-submitted`
    )
    expect(createAgentRunId(`Summarizer #1`)).toBe(`agent_run_summarizer-1`)
  })

  it(`uses expected prefixes`, () => {
    expect(createWikiSpaceId(`demo`).startsWith(WIKI_SPACE_ID_PREFIX)).toBe(
      true
    )
    expect(createActorId(`demo`).startsWith(ACTOR_ID_PREFIX)).toBe(true)
    expect(
      createMembershipId(`wiki_demo`, `actor_ada`).startsWith(
        MEMBERSHIP_ID_PREFIX
      )
    ).toBe(true)
    expect(createSourceId(`demo`).startsWith(SOURCE_ID_PREFIX)).toBe(true)
    expect(createWikiPageId(`demo`).startsWith(WIKI_PAGE_ID_PREFIX)).toBe(true)
    expect(
      createWikiLinkId(`page_a`, `page_b`).startsWith(WIKI_LINK_ID_PREFIX)
    ).toBe(true)
    expect(createReviewItemId(`demo`).startsWith(REVIEW_ITEM_ID_PREFIX)).toBe(
      true
    )
    expect(
      createActivityEventId(`demo`).startsWith(ACTIVITY_EVENT_ID_PREFIX)
    ).toBe(true)
    expect(createAgentRunId(`demo`).startsWith(AGENT_RUN_ID_PREFIX)).toBe(true)
  })

  it(`creates URL-safe lowercase ids and normalizes unsafe or empty seeds`, () => {
    const ids = [
      createWikiSpaceId(`A B/C.D!`),
      createActorId(``),
      createSourceId(`///`),
      createWikiPageId(`Symbols: ♥ & ?`),
      createReviewItemId(`UPPER_case`),
    ]

    for (const id of ids) {
      expect(id).toMatch(urlSafeIdPattern)
      expect(id).not.toContain(`/`)
      expect(id).not.toContain(`.`)
    }

    expect(createActorId(``)).toBe(`actor_generated`)
    expect(createSourceId(`///`)).toBe(`source_generated`)
  })

  it(`creates composite deterministic membership and link ids`, () => {
    expect(createMembershipId(`wiki_demo`, `actor_ada`)).toBe(
      `membership_wiki_demo_actor_ada`
    )
    expect(createWikiLinkId(`page_alpha`, `page_beta`, `Related To`)).toBe(
      `link_page_alpha_page_beta_related-to`
    )
    expect(createWikiLinkId(`page_alpha`, `page_beta`)).toBe(
      `link_page_alpha_page_beta`
    )
  })

  it(`creates URL-safe generated ids when optional seeds are omitted`, () => {
    expect(createWikiSpaceId()).toMatch(/^wiki_[a-z0-9_-]+$/)
    expect(createActorId()).toMatch(/^actor_[a-z0-9_-]+$/)
    expect(createActivityEventId()).toMatch(/^event_[a-z0-9_-]+$/)
  })

  it(`formats timestamps with an injected clock`, () => {
    expect(nowIsoTimestamp(() => new Date(`2026-06-03T12:34:56.789Z`))).toBe(
      `2026-06-03T12:34:56.789Z`
    )
  })

  it(`derives shared-state ids with parity to the worker target resolver`, () => {
    const wikiSpaceId = createWikiSpaceId(`Demo Space`)

    expect(deriveLivingWikiSharedStateId(wikiSpaceId)).toBe(
      `living-wiki:wiki_demo-space`
    )
    expect(
      resolveObserveTarget({ wikiSpaceId, observeKind: `shared-state` })
    ).toMatchObject({
      sharedStateId: deriveLivingWikiSharedStateId(wikiSpaceId),
    })
  })

  it.each([`demo`, `Wiki_demo`, `wiki/demo`, `wiki.demo`, `wiki_`, ``])(
    `rejects invalid wikiSpaceId %j for shared-state derivation`,
    (wikiSpaceId) => {
      expect(() => deriveLivingWikiSharedStateId(wikiSpaceId)).toThrow()
    }
  )
})
