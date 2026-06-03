import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { demoSessionStorageKey } from '../../shared/session'
import { useCreateSpace, useJoinSpace, useSpace } from './useSpace'

const originalFetch = globalThis.fetch

const createdAt = `2026-06-03T00:00:00.000Z`

const makeSnapshot = (
  overrides: {
    wikiSpaceId?: string
    actorId?: string
    displayName?: string
  } = {}
) => {
  const wikiSpaceId = overrides.wikiSpaceId ?? `wiki_test`
  const actorId = overrides.actorId ?? `actor_test`

  return {
    space: {
      id: wikiSpaceId,
      title: `Test Space`,
      createdAt,
      createdByActorId: actorId,
      memberCount: 1,
    },
    currentActor: {
      id: actorId,
      wikiSpaceId,
      kind: `human`,
      displayName: overrides.displayName ?? `Ada`,
      avatarColor: `blue`,
      createdAt,
    },
    actors: [
      {
        id: actorId,
        wikiSpaceId,
        kind: `human`,
        displayName: overrides.displayName ?? `Ada`,
        avatarColor: `blue`,
        createdAt,
      },
    ],
  }
}

afterEach(() => {
  globalThis.fetch = originalFetch
  window.localStorage.clear()
  vi.restoreAllMocks()
})

describe(`useSpace`, () => {
  it(`loads a space and supports refresh`, async () => {
    const firstSnapshot = makeSnapshot({ displayName: `Ada` })
    const refreshedSnapshot = makeSnapshot({ displayName: `Grace` })
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(firstSnapshot), {
          headers: { 'content-type': `application/json` },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(refreshedSnapshot), {
          headers: { 'content-type': `application/json` },
        })
      ) as typeof fetch

    const { result } = renderHook(() => useSpace(`wiki_test`, `actor_test`))

    await waitFor(() =>
      expect(result.current.space?.currentActor.displayName).toBe(`Ada`)
    )
    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/spaces/wiki_test?actorId=actor_test`,
      { method: `GET` }
    )

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.space?.currentActor.displayName).toBe(`Grace`)
    expect(globalThis.fetch).toHaveBeenCalledTimes(2)
  })

  it(`exposes load errors`, async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: `not found` }), {
          status: 404,
          statusText: `Not Found`,
        })
    ) as typeof fetch

    const { result } = renderHook(() => useSpace(`wiki_missing`))

    await waitFor(() => expect(result.current.error?.message).toBe(`not found`))
    expect(result.current.space).toBeNull()
    expect(result.current.loading).toBe(false)
  })
})

describe(`useCreateSpace`, () => {
  it(`persists the returned actor identity`, async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            makeSnapshot({ actorId: `actor_created`, displayName: `Creator` })
          ),
          { headers: { 'content-type': `application/json` } }
        )
    ) as typeof fetch

    const { result } = renderHook(() => useCreateSpace())

    await act(async () => {
      await result.current.createSpace({
        title: `Created`,
        displayName: `Creator`,
        avatarColor: `blue`,
      })
    })

    expect(
      JSON.parse(window.localStorage.getItem(demoSessionStorageKey) ?? `{}`)
    ).toEqual({
      actorId: `actor_created`,
      displayName: `Creator`,
      avatarColor: `blue`,
    })
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })
})

describe(`useJoinSpace`, () => {
  it(`persists the returned actor identity`, async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify(
            makeSnapshot({ actorId: `actor_joined`, displayName: `Joiner` })
          ),
          { headers: { 'content-type': `application/json` } }
        )
    ) as typeof fetch

    const { result } = renderHook(() => useJoinSpace(`wiki_test`))

    await act(async () => {
      await result.current.joinSpace({
        displayName: `Joiner`,
        avatarColor: `green`,
      })
    })

    expect(globalThis.fetch).toHaveBeenCalledWith(
      `/api/spaces/wiki_test/join`,
      expect.objectContaining({ method: `POST` })
    )
    expect(
      JSON.parse(window.localStorage.getItem(demoSessionStorageKey) ?? `{}`)
    ).toEqual({
      actorId: `actor_joined`,
      displayName: `Joiner`,
      avatarColor: `blue`,
    })
  })
})
