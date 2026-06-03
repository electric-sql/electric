import { renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useLivingWikiStateViewModels } from './useLivingWikiStateViewModels'
import type { LivingWikiStateDb } from '../db/wikiStateDb'
import type {
  ActivityEventRow,
  ActorRow,
  MembershipRow,
  ReviewItemRow,
  SourceRow,
  WikiLinkRow,
  WikiPageRow,
} from '../../shared/wiki-state'

const now = `2026-06-03T00:00:00.000Z`

function makeFakeDb() {
  const collections = {
    actors: { name: `actors` },
    memberships: { name: `memberships` },
    activity_events: { name: `activity_events` },
    sources: { name: `sources` },
    wiki_pages: { name: `wiki_pages` },
    wiki_links: { name: `wiki_links` },
    review_items: { name: `review_items` },
    wiki_spaces: { name: `wiki_spaces` },
    agent_runs: { name: `agent_runs` },
  }
  return {
    collections,
    preload: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as LivingWikiStateDb & {
    collections: typeof collections
    preload: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
  }
}

describe(`useLivingWikiStateViewModels`, () => {
  it(`returns empty/default view models while no live rows are loaded`, () => {
    const db = makeFakeDb()
    const { result } = renderHook(() =>
      useLivingWikiStateViewModels({
        db,
        ownLifecycle: false,
        queryAdapter: () => ({ data: undefined, isLoading: true }),
      })
    )

    expect(result.current.isLoading).toBe(true)
    expect(result.current.isError).toBe(false)
    expect(result.current.viewModel.activityEvents).toEqual([])
    expect(result.current.viewModel.members).toEqual([])
    expect(result.current.viewModel.sources).toEqual({
      submitted: [],
      published: [],
      rejected: [],
    })
    expect(result.current.viewModel.graphSummary.totalPages).toBe(0)
    expect(result.current.viewModel.reviewSummary.hasOpenItems).toBe(false)
  })

  it(`maps fake live query rows through the shared-state selectors`, () => {
    const db = makeFakeDb()
    const actor: ActorRow = {
      id: `actor_ada`,
      wiki_space_id: `wiki_test`,
      kind: `human`,
      display_name: `Ada`,
      avatar_color: `blue`,
      created_at: now,
    }
    const membership: MembershipRow = {
      id: `membership_ada`,
      wiki_space_id: `wiki_test`,
      actor_id: `actor_ada`,
      role: `owner`,
      joined_at: now,
      status: `active`,
    }
    const activity: ActivityEventRow[] = [
      {
        id: `event_old`,
        wiki_space_id: `wiki_test`,
        occurred_at: `2026-06-03T00:00:00.000Z`,
        actor_id: `actor_ada`,
        actor_kind: `human`,
        event_type: `joined`,
        summary: `Ada joined`,
        subject_type: `membership`,
        subject_id: `membership_ada`,
        visibility: `ambient`,
        metadata: {},
      },
      {
        id: `event_new`,
        wiki_space_id: `wiki_test`,
        occurred_at: `2026-06-03T01:00:00.000Z`,
        actor_id: `actor_ada`,
        actor_kind: `human`,
        event_type: `published`,
        summary: `Source published`,
        subject_type: `source`,
        subject_id: `source_one`,
        visibility: `ambient`,
        metadata: {},
      },
    ]
    const source: SourceRow = {
      id: `source_one`,
      wiki_space_id: `wiki_test`,
      kind: `url`,
      status: `published`,
      title: `Durable Streams`,
      url: `https://example.com`,
      text_preview: null,
      submitted_by_actor_id: `actor_ada`,
      submitted_at: now,
      published_at: now,
      metadata: {},
    }
    const page: WikiPageRow = {
      id: `page_one`,
      wiki_space_id: `wiki_test`,
      slug: `one`,
      title: `One`,
      status: `canonical`,
      summary: null,
      body: null,
      source_ids: [`source_one`],
      created_at: now,
      updated_at: now,
      created_by_run_id: null,
    }
    const link: WikiLinkRow = {
      id: `link_one`,
      wiki_space_id: `wiki_test`,
      from_page_id: `page_one`,
      to_page_id: `page_one`,
      status: `proposed`,
      label: null,
      rationale: null,
      source_ids: [],
      created_at: now,
      created_by_run_id: null,
    }
    const review: ReviewItemRow = {
      id: `review_one`,
      wiki_space_id: `wiki_test`,
      kind: `page`,
      status: `open`,
      target_type: `wiki_page`,
      target_id: `page_one`,
      suggested_change: `Approve page`,
      rationale: null,
      created_at: now,
      created_by_run_id: null,
      resolved_at: null,
      resolved_by_actor_id: null,
      resolution_note: null,
    }
    const rows = new Map<unknown, unknown[]>([
      [db.collections.actors, [actor]],
      [db.collections.memberships, [membership]],
      [db.collections.activity_events, activity],
      [db.collections.sources, [source]],
      [db.collections.wiki_pages, [page]],
      [db.collections.wiki_links, [link]],
      [db.collections.review_items, [review]],
    ])

    const { result } = renderHook(() =>
      useLivingWikiStateViewModels({
        db,
        ownLifecycle: false,
        queryAdapter: <T,>(collection: unknown) => ({
          data: (rows.get(collection) ?? []) as T[],
        }),
      })
    )

    expect(
      result.current.viewModel.activityEvents.map((event) => event.id)
    ).toEqual([`event_new`, `event_old`])
    expect(result.current.viewModel.members[0]).toMatchObject({
      displayName: `Ada`,
      role: `owner`,
    })
    expect(result.current.viewModel.sources.published).toHaveLength(1)
    expect(result.current.viewModel.graphSummary.pages.canonical).toBe(1)
    expect(result.current.viewModel.graphSummary.links.proposed).toBe(1)
    expect(result.current.viewModel.reviewSummary).toMatchObject({
      open: 1,
      hasOpenItems: true,
    })
  })

  it(`preloads and closes an owned injected DB without creating real streams`, async () => {
    const db = makeFakeDb()
    const createDb = vi.fn(() => db)
    const { unmount } = renderHook(() =>
      useLivingWikiStateViewModels({
        wikiSpaceId: `wiki_test`,
        createDb,
        queryAdapter: () => ({ data: [] }),
      })
    )

    await waitFor(() => expect(db.preload).toHaveBeenCalledTimes(1))
    expect(createDb).toHaveBeenCalledWith({ wikiSpaceId: `wiki_test` })

    unmount()

    expect(db.close).toHaveBeenCalledTimes(1)
  })
})
