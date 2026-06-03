import { describe, expect, it } from 'vitest'
import type {
  ActivityEventRow,
  ActorRow,
  MembershipRow,
  ReviewItemRow,
  SourceRow,
  WikiLinkRow,
  WikiPageRow,
} from '../../shared/wiki-state'
import {
  selectMemberCards,
  selectRecentActivity,
  selectReviewQueueSummary,
  selectSourcesByStatus,
  selectWikiGraphSummary,
  selectWikiPageCards,
} from './wikiStateViewModels'

const t = `2026-06-03T00:00:00.000Z`
const actor = (id: string, display_name = id): ActorRow => ({
  id,
  wiki_space_id: `wiki_test`,
  kind: `human`,
  display_name,
  avatar_color: `blue`,
  created_at: t,
})
const membership = (
  id: string,
  actor_id: string,
  status: MembershipRow[`status`] = `active`,
  role: MembershipRow[`role`] = `member`
): MembershipRow => ({
  id,
  wiki_space_id: `wiki_test`,
  actor_id,
  role,
  joined_at: t,
  status,
})
const source = (id: string, status: SourceRow[`status`]): SourceRow => ({
  id,
  wiki_space_id: `wiki_test`,
  kind: `text`,
  status,
  title: `${status} source`,
  url: null,
  text_preview: `preview`,
  submitted_by_actor_id: `actor_ada`,
  submitted_at: t,
  published_at: status === `published` ? t : null,
  metadata: {},
})
const page = (id: string, status: WikiPageRow[`status`]): WikiPageRow => ({
  id,
  wiki_space_id: `wiki_test`,
  slug: id.replace(`page_`, ``),
  title: id,
  status,
  summary: null,
  body: null,
  source_ids: [],
  created_at: t,
  updated_at: t,
  created_by_run_id: null,
})
const link = (id: string, status: WikiLinkRow[`status`]): WikiLinkRow => ({
  id,
  wiki_space_id: `wiki_test`,
  from_page_id: `page_a`,
  to_page_id: `page_b`,
  status,
  label: null,
  rationale: null,
  source_ids: [],
  created_at: t,
  created_by_run_id: null,
})
const review = (
  id: string,
  status: ReviewItemRow[`status`]
): ReviewItemRow => ({
  id,
  wiki_space_id: `wiki_test`,
  kind: `page`,
  status,
  target_type: `page`,
  target_id: `page_a`,
  suggested_change: `Review this`,
  rationale: null,
  created_at: t,
  created_by_run_id: null,
  resolved_at: status === `open` ? null : t,
  resolved_by_actor_id: status === `open` ? null : `actor_ada`,
  resolution_note: null,
})

describe(`wiki state view-model selectors`, () => {
  it(`returns empty results for empty inputs`, () => {
    expect(selectRecentActivity([])).toEqual([])
    expect(selectMemberCards([], [])).toEqual([])
    expect(selectSourcesByStatus([])).toEqual({
      submitted: [],
      published: [],
      rejected: [],
    })
    expect(selectWikiGraphSummary([], [])).toEqual({
      pages: { proposed: 0, canonical: 0, rejected: 0, total: 0 },
      links: { proposed: 0, canonical: 0, rejected: 0, total: 0 },
      totalPages: 0,
      totalLinks: 0,
    })
    expect(selectReviewQueueSummary([])).toEqual({
      open: 0,
      approved: 0,
      rejected: 0,
      total: 0,
      hasOpenItems: false,
    })
    expect(selectWikiPageCards([])).toEqual([])
  })

  it(`sorts recent activity by occurred_at descending`, () => {
    const events = [`01`, `03`, `02`].map(
      (day): ActivityEventRow => ({
        id: `event_${day}`,
        wiki_space_id: `wiki_test`,
        occurred_at: `2026-06-${day}T00:00:00.000Z`,
        actor_id: `actor_ada`,
        actor_kind: `human`,
        event_type: `note`,
        summary: day,
        subject_type: `source`,
        subject_id: `source_${day}`,
        visibility: `ambient`,
        metadata: {},
      })
    )
    expect(selectRecentActivity(events).map((event) => event.id)).toEqual([
      `event_03`,
      `event_02`,
      `event_01`,
    ])
  })

  it(`joins members with actors and handles missing actors`, () => {
    const cards = selectMemberCards(
      [
        membership(`membership_ada`, `actor_ada`, `active`, `owner`),
        membership(`membership_missing`, `actor_missing`, `left`, `observer`),
      ],
      [actor(`actor_ada`, `Ada`)]
    )
    expect(cards[0]).toMatchObject({
      displayName: `Ada`,
      role: `owner`,
      status: `active`,
      actorMissing: false,
    })
    expect(cards[1]).toMatchObject({
      displayName: `Unknown actor`,
      role: `observer`,
      status: `left`,
      actorMissing: true,
    })
  })

  it(`maps page cards in demo-friendly status order`, () => {
    const cards = selectWikiPageCards([
      {
        ...page(`page_zed`, `rejected`),
        title: `Zed`,
        summary: null,
        body: `A long rejected page body.`,
        source_ids: [`source_a`, `source_b`],
      },
      { ...page(`page_alpha`, `canonical`), title: `Alpha`, summary: `Ready` },
      {
        ...page(`page_beta`, `proposed`),
        title: `Beta`,
        summary: `Needs review`,
      },
    ])

    expect(cards.map((card) => `${card.status}:${card.title}`)).toEqual([
      `canonical:Alpha`,
      `proposed:Beta`,
      `rejected:Zed`,
    ])
    expect(cards[2]).toMatchObject({
      slug: `zed`,
      bodyPreview: `A long rejected page body.`,
      sourceCount: 2,
    })
  })

  it(`groups sources and counts graph/review statuses`, () => {
    expect(
      selectSourcesByStatus([
        source(`source_a`, `submitted`),
        source(`source_b`, `published`),
        source(`source_c`, `rejected`),
      ]).published
    ).toHaveLength(1)
    expect(
      selectWikiGraphSummary(
        [page(`page_a`, `canonical`), page(`page_b`, `proposed`)],
        [link(`link_a`, `rejected`)]
      )
    ).toMatchObject({
      totalPages: 2,
      totalLinks: 1,
      pages: { canonical: 1, proposed: 1 },
      links: { rejected: 1 },
    })
    expect(
      selectReviewQueueSummary([
        review(`review_a`, `open`),
        review(`review_b`, `approved`),
        review(`review_c`, `rejected`),
      ])
    ).toEqual({
      open: 1,
      approved: 1,
      rejected: 1,
      total: 3,
      hasOpenItems: true,
    })
  })
})
