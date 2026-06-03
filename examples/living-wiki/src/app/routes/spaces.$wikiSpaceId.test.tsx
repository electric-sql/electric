import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoSessionStorageKey } from '../../shared/session'
import { SpaceRoutePage } from './spaces.$wikiSpaceId'

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
})
