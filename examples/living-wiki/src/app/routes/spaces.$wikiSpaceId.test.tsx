import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoSessionStorageKey } from '../../shared/session'
import { SpaceRoutePage } from './spaces.$wikiSpaceId'

const refreshSharedState = vi.fn(async () => {})
const emptySharedStateViewModel: any = {
  activityEvents: [],
  members: [],
  sources: { submitted: [], published: [], rejected: [] },
  graphSummary: {
    pages: { proposed: 0, canonical: 0, rejected: 0, total: 0 },
    links: { proposed: 0, canonical: 0, rejected: 0, total: 0 },
    totalPages: 0,
    totalLinks: 0,
  },
  reviewSummary: {
    open: 0,
    approved: 0,
    rejected: 0,
    total: 0,
    hasOpenItems: false,
  },
  reviewItems: [],
}
let sharedStateViewModel = emptySharedStateViewModel

vi.mock(`../hooks/useLivingWikiStateSnapshot`, () => ({
  useLivingWikiStateSnapshot: () => ({
    viewModel: sharedStateViewModel,
    loading: false,
    error: null,
    refresh: refreshSharedState,
  }),
}))

const originalFetch = globalThis.fetch
const createdAt = `2026-06-03T00:00:00.000Z`
const makeSnapshot = (
  overrides: { memberCount?: number; displayName?: string } = {}
) => ({
  space: {
    id: `wiki_test`,
    title: `Test Space`,
    createdAt,
    createdByActorId: `actor_ada`,
    memberCount: overrides.memberCount ?? 2,
  },
  currentActor: {
    id: `actor_ada`,
    wikiSpaceId: `wiki_test`,
    kind: `human`,
    displayName: overrides.displayName ?? `Ada`,
    avatarColor: `blue`,
    createdAt,
  },
  actors: [
    {
      id: `actor_ada`,
      wikiSpaceId: `wiki_test`,
      kind: `human`,
      displayName: `Ada`,
      avatarColor: `blue`,
      createdAt,
    },
    {
      id: `actor_grace`,
      wikiSpaceId: `wiki_test`,
      kind: `human`,
      displayName: `Grace`,
      avatarColor: `green`,
      createdAt,
    },
  ],
})

const sourceRow = {
  id: `source_note`,
  wiki_space_id: `wiki_test`,
  kind: `text`,
  status: `submitted`,
  title: `Room note`,
  url: null,
  text_preview: `Important local knowledge`,
  submitted_by_actor_id: `actor_ada`,
  submitted_at: createdAt,
  published_at: null,
  metadata: { body_length: 25 },
} as const
const reviewRow = {
  id: `review_note`,
  wiki_space_id: `wiki_test`,
  kind: `page`,
  status: `open`,
  target_type: `wiki_page`,
  target_id: `page_note`,
  suggested_change: `Review proposed page: Room note`,
  rationale: null,
  created_at: createdAt,
  created_by_run_id: null,
  resolved_at: null,
  resolved_by_actor_id: null,
  resolution_note: null,
} as const
const pageRow = {
  id: `page_note`,
  wiki_space_id: `wiki_test`,
  slug: `room-note`,
  title: `Room note`,
  status: `proposed`,
  summary: `Summary`,
  body: `Body`,
  source_ids: [`source_note`],
  created_at: createdAt,
  updated_at: createdAt,
  created_by_run_id: null,
} as const

afterEach(() => {
  globalThis.fetch = originalFetch
  window.localStorage.clear()
  refreshSharedState.mockClear()
  sharedStateViewModel = emptySharedStateViewModel
  vi.restoreAllMocks()
})

describe(`SpaceRoutePage`, () => {
  it(`renders loaded space data and the join form`, async () => {
    window.localStorage.setItem(
      demoSessionStorageKey,
      JSON.stringify({
        actorId: `actor_ada`,
        displayName: `Ada`,
        avatarColor: `blue`,
      })
    )
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify(makeSnapshot()), {
          headers: { 'content-type': `application/json` },
        })
    ) as typeof fetch
    render(<SpaceRoutePage wikiSpaceId="wiki_test" />)
    await screen.findByRole(`heading`, { name: `Test Space` })
    expect(screen.getByText(`2 members`)).toBeInTheDocument()
    expect(screen.getByText(`Current actor: Ada`)).toBeInTheDocument()
    expect(screen.getByText(`Grace`)).toBeInTheDocument()
    expect(
      screen.getByRole(`region`, { name: `Living wiki shared-state dashboard` })
    ).toBeInTheDocument()
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/spaces/wiki_test?actorId=actor_ada`,
      { method: `GET` }
    )
  })

  it(`submits the join form and refreshes displayed identity`, async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeSnapshot()), {
          headers: { 'content-type': `application/json` },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            makeSnapshot({ displayName: `Katherine`, memberCount: 3 })
          ),
          { headers: { 'content-type': `application/json` } }
        )
      ) as typeof fetch
    render(<SpaceRoutePage wikiSpaceId="wiki_test" />)
    await screen.findByRole(`heading`, { name: `Test Space` })
    fireEvent.change(screen.getByRole(`textbox`, { name: `Display name` }), {
      target: { value: `Katherine` },
    })
    fireEvent.change(screen.getByLabelText(`Avatar color`), {
      target: { value: `purple` },
    })
    fireEvent.click(screen.getByRole(`button`, { name: `Join space` }))
    await waitFor(() =>
      expect(screen.getByText(`Current actor: Katherine`)).toBeInTheDocument()
    )
  })

  it(`submits a text source and refreshes shared state`, async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeSnapshot()), {
          headers: { 'content-type': `application/json` },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            source: sourceRow,
            activityEventId: `event_source-note`,
          }),
          { headers: { 'content-type': `application/json` } }
        )
      ) as typeof fetch
    render(<SpaceRoutePage wikiSpaceId="wiki_test" />)
    await screen.findByRole(`heading`, { name: `Test Space` })
    fireEvent.change(screen.getByRole(`textbox`, { name: `Source title` }), {
      target: { value: `Room note` },
    })
    fireEvent.change(screen.getByRole(`textbox`, { name: `Source text` }), {
      target: { value: `Important local knowledge` },
    })
    fireEvent.click(screen.getByRole(`button`, { name: `Submit source` }))
    expect(
      screen.getByRole(`button`, { name: `Submitting source…` })
    ).toBeInTheDocument()
    await waitFor(() => expect(refreshSharedState).toHaveBeenCalled())
    expect(screen.getByText(`Source submitted.`)).toBeInTheDocument()
    const [, init] = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(
        ([path]) => path === `/api/spaces/wiki_test/sources`
      ) as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      actorId: `actor_ada`,
      kind: `text`,
      title: `Room note`,
      body: `Important local knowledge`,
    })
  })

  it(`proposes a page from a submitted source without manual ID entry`, async () => {
    sharedStateViewModel = {
      ...emptySharedStateViewModel,
      sources: { submitted: [sourceRow], published: [], rejected: [] },
    }
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(makeSnapshot()), {
          headers: { 'content-type': `application/json` },
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            page: pageRow,
            reviewItem: reviewRow,
            activityEventId: `event_page-proposed`,
          }),
          { headers: { 'content-type': `application/json` } }
        )
      ) as typeof fetch
    render(<SpaceRoutePage wikiSpaceId="wiki_test" />)
    await screen.findByRole(`heading`, { name: `Test Space` })
    fireEvent.click(screen.getByRole(`button`, { name: `Propose page` }))
    expect(screen.getByText(`Proposing page…`)).toBeInTheDocument()
    await waitFor(() => expect(refreshSharedState).toHaveBeenCalled())
    expect(screen.getByText(`Page proposal created.`)).toBeInTheDocument()
    const [, init] = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(
        ([path]) => path === `/api/spaces/wiki_test/pages/propose`
      ) as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      actorId: `actor_ada`,
      sourceId: `source_note`,
    })
  })

  it(`resolves an open review from inline review actions`, async () => {
    sharedStateViewModel = {
      ...emptySharedStateViewModel,
      reviewSummary: {
        open: 1,
        approved: 0,
        rejected: 0,
        total: 1,
        hasOpenItems: true,
      },
      reviewItems: [reviewRow],
    }
    globalThis.fetch = vi.fn(async (path) =>
      String(path).endsWith(`/resolve`)
        ? new Response(
            JSON.stringify({
              page: { ...pageRow, status: `canonical` },
              reviewItem: {
                ...reviewRow,
                status: `approved`,
                resolved_at: createdAt,
                resolved_by_actor_id: `actor_ada`,
              },
              activityEventId: `event_review-approved`,
            }),
            { headers: { 'content-type': `application/json` } }
          )
        : new Response(JSON.stringify(makeSnapshot()), {
            headers: { 'content-type': `application/json` },
          })
    ) as typeof fetch
    render(<SpaceRoutePage wikiSpaceId="wiki_test" />)
    await screen.findByRole(`heading`, { name: `Test Space` })
    fireEvent.click(
      screen.getByRole(`button`, {
        name: `Approve review: Review proposed page: Room note`,
      })
    )
    expect(screen.getByText(`Resolving review…`)).toBeInTheDocument()
    await waitFor(() => expect(refreshSharedState).toHaveBeenCalled())
    expect(screen.getByText(`Review approved.`)).toBeInTheDocument()
    const [, init] = vi
      .mocked(globalThis.fetch)
      .mock.calls.find(
        ([path]) => path === `/api/spaces/wiki_test/reviews/review_note/resolve`
      ) as [string, RequestInit]
    expect(JSON.parse(String(init.body))).toEqual({
      actorId: `actor_ada`,
      resolution: `approve`,
    })
  })
})
