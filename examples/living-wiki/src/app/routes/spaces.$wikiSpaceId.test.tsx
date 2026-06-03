import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoSessionStorageKey } from '../../shared/session'
import { SpaceRoutePage } from './spaces.$wikiSpaceId'

const refreshSharedState = vi.fn(async () => {})

vi.mock(`../hooks/useLivingWikiStateSnapshot`, () => ({
  useLivingWikiStateSnapshot: () => ({
    viewModel: {
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
    },
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

afterEach(() => {
  globalThis.fetch = originalFetch
  window.localStorage.clear()
  refreshSharedState.mockClear()
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

    await waitFor(() =>
      expect(
        screen.getByRole(`heading`, { name: `Test Space` })
      ).toBeInTheDocument()
    )
    expect(screen.getByText(`2 members`)).toBeInTheDocument()
    expect(screen.getByText(`Current actor: Ada`)).toBeInTheDocument()
    expect(screen.getByText(`Grace`)).toBeInTheDocument()
    expect(screen.getByRole(`button`, { name: `Refresh` })).toBeInTheDocument()
    expect(
      screen.getByRole(`region`, { name: `Living wiki shared-state dashboard` })
    ).toBeInTheDocument()
    expect(
      screen.getByText(`No activity yet. New wiki updates will appear here.`)
    ).toBeInTheDocument()
    expect(
      screen.getByRole(`textbox`, { name: `Display name` })
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
          {
            headers: { 'content-type': `application/json` },
          }
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
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/spaces/wiki_test/join`,
      {
        method: `POST`,
        headers: { 'content-type': `application/json` },
        body: JSON.stringify({
          displayName: `Katherine`,
          avatarColor: `purple`,
        }),
      }
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
            source: {
              id: `source_note`,
              wiki_space_id: `wiki_test`,
              kind: `text`,
              status: `submitted`,
              title: `Room note`,
              url: null,
              text_preview: `Important local knowledge`,
              submitted_by_actor_id: `actor_ada`,
              submitted_at: `2026-06-03T00:00:00.000Z`,
              published_at: null,
              metadata: { body_length: 25 },
            },
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

    await waitFor(() => expect(refreshSharedState).toHaveBeenCalled())
    const calls = vi.mocked(globalThis.fetch).mock.calls
    const sourceCall = calls.find(
      ([path]) => path === `/api/spaces/wiki_test/sources`
    )
    expect(sourceCall).toBeDefined()
    const [, sourceInit] = sourceCall as [string, RequestInit]
    expect(sourceInit).toMatchObject({
      method: `POST`,
      headers: { 'content-type': `application/json` },
    })
    expect(JSON.parse(String(sourceInit.body))).toEqual({
      actorId: `actor_ada`,
      kind: `text`,
      title: `Room note`,
      body: `Important local knowledge`,
    })
  })
})
