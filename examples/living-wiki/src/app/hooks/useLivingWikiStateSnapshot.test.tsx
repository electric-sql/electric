import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LivingWikiApiClient } from '../api/livingWikiApi'
import {
  snapshotToViewModel,
  useLivingWikiStateSnapshot,
} from './useLivingWikiStateSnapshot'

const emptyRows = {
  wiki_spaces: [],
  actors: [],
  memberships: [],
  activity_events: [],
  sources: [],
  wiki_pages: [],
  wiki_links: [],
  review_items: [],
  agent_runs: [],
}

const client = (overrides: Partial<LivingWikiApiClient>): LivingWikiApiClient =>
  ({
    createSpace: vi.fn(),
    joinSpace: vi.fn(),
    getSpace: vi.fn(),
    getSharedStateSnapshot: vi.fn(async () => emptyRows),
    submitSource: vi.fn(),
    ...overrides,
  }) as LivingWikiApiClient

describe(`useLivingWikiStateSnapshot`, () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it(`maps snapshot rows to dashboard view models`, () => {
    const viewModel = snapshotToViewModel({
      ...emptyRows,
      actors: [
        {
          id: `actor_alice`,
          wiki_space_id: `wiki_demo`,
          kind: `human`,
          display_name: `Alice`,
          avatar_color: `blue`,
          created_at: `2026-06-03T00:00:00.000Z`,
        },
      ],
      wiki_pages: [
        {
          id: `page_demo`,
          wiki_space_id: `wiki_demo`,
          slug: `demo`,
          title: `Demo`,
          status: `canonical`,
          summary: `Demo summary`,
          body: null,
          source_ids: [],
          created_at: `2026-06-03T00:00:00.000Z`,
          updated_at: `2026-06-03T00:00:00.000Z`,
          created_by_run_id: null,
        },
      ],
      memberships: [
        {
          id: `membership_wiki_demo_actor_alice`,
          wiki_space_id: `wiki_demo`,
          actor_id: `actor_alice`,
          role: `owner`,
          joined_at: `2026-06-03T00:00:00.000Z`,
          status: `active`,
        },
      ],
    })

    expect(viewModel.members).toEqual([
      expect.objectContaining({ displayName: `Alice`, role: `owner` }),
    ])
    expect(viewModel.pageCards).toEqual([
      expect.objectContaining({ title: `Demo`, status: `canonical` }),
    ])
  })

  it(`loads snapshot rows through the injected API client`, async () => {
    const getSharedStateSnapshot = vi.fn(async () => emptyRows)
    const api = client({ getSharedStateSnapshot })

    const { result } = renderHook(() =>
      useLivingWikiStateSnapshot({ wikiSpaceId: `wiki_demo`, client: api })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(getSharedStateSnapshot).toHaveBeenCalledWith({
      wikiSpaceId: `wiki_demo`,
    })
    expect(result.current.error).toBeNull()
  })

  it(`does not refetch on rerender when using the default API client`, async () => {
    const fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(emptyRows), {
          headers: { 'content-type': `application/json` },
        })
    )
    vi.stubGlobal(`fetch`, fetch)

    const { result, rerender } = renderHook(() =>
      useLivingWikiStateSnapshot({ wikiSpaceId: `wiki_demo` })
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender()

    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch).toHaveBeenCalledWith(
      `/api/spaces/wiki_demo/shared-state-snapshot`,
      { method: `GET` }
    )
  })
})
