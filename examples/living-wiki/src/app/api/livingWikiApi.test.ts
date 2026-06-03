import { describe, expect, it, vi } from 'vitest'
import { createLivingWikiApiClient, LivingWikiApiError } from './livingWikiApi'
import type { WikiSpaceSnapshot } from '../../shared/space'

const snapshot: WikiSpaceSnapshot = {
  space: {
    id: `wiki_demo`,
    title: `Demo Space`,
    createdAt: `2026-06-03T00:00:00.000Z`,
    createdByActorId: `actor_alice`,
    memberCount: 1,
  },
  currentActor: {
    id: `actor_alice`,
    wikiSpaceId: `wiki_demo`,
    kind: `human`,
    displayName: `Alice`,
    avatarColor: `blue`,
    createdAt: `2026-06-03T00:00:00.000Z`,
  },
  actors: [
    {
      id: `actor_alice`,
      wikiSpaceId: `wiki_demo`,
      kind: `human`,
      displayName: `Alice`,
      avatarColor: `blue`,
      createdAt: `2026-06-03T00:00:00.000Z`,
    },
  ],
}

const jsonResponse = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': `application/json`, ...(init?.headers ?? {}) },
  })

describe(`createLivingWikiApiClient`, () => {
  it(`POSTs createSpace to /api/spaces and validates the snapshot`, async () => {
    const fetchMock = vi.fn(async () => jsonResponse(snapshot))
    const api = createLivingWikiApiClient({ fetch: fetchMock as typeof fetch })

    await expect(
      api.createSpace({
        title: `Demo Space`,
        displayName: `Alice`,
        avatarColor: `blue`,
      })
    ).resolves.toEqual(snapshot)

    expect(fetchMock).toHaveBeenCalledWith(`/api/spaces`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        title: `Demo Space`,
        displayName: `Alice`,
        avatarColor: `blue`,
      }),
    })
  })

  it(`POSTs joinSpace to /api/spaces/:wikiSpaceId/join without duplicating wikiSpaceId in the body`, async () => {
    const fetchMock = vi.fn(async () => jsonResponse(snapshot))
    const api = createLivingWikiApiClient({ fetch: fetchMock as typeof fetch })

    await api.joinSpace({
      wikiSpaceId: `wiki_demo`,
      displayName: `Bob`,
      avatarColor: `green`,
      actorId: `actor_bob`,
    })

    expect(fetchMock).toHaveBeenCalledWith(`/api/spaces/wiki_demo/join`, {
      method: `POST`,
      headers: { 'content-type': `application/json` },
      body: JSON.stringify({
        displayName: `Bob`,
        avatarColor: `green`,
        actorId: `actor_bob`,
      }),
    })
  })

  it(`GETs getSpace and includes actorId query parameter when provided`, async () => {
    const fetchMock = vi.fn(async () => jsonResponse(snapshot))
    const api = createLivingWikiApiClient({ fetch: fetchMock as typeof fetch })

    await api.getSpace({ wikiSpaceId: `wiki_demo`, actorId: `actor_alice` })

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/spaces/wiki_demo?actorId=actor_alice`,
      { method: `GET` }
    )
  })

  it(`GETs getSpace without query parameter when actorId is omitted`, async () => {
    const fetchMock = vi.fn(async () => jsonResponse(snapshot))
    const api = createLivingWikiApiClient({ fetch: fetchMock as typeof fetch })

    await api.getSpace({ wikiSpaceId: `wiki_demo` })

    expect(fetchMock).toHaveBeenCalledWith(`/api/spaces/wiki_demo`, {
      method: `GET`,
    })
  })

  it(`supports baseUrl and avoids double slashes`, async () => {
    const fetchMock = vi.fn(async () => jsonResponse(snapshot))
    const api = createLivingWikiApiClient({
      baseUrl: `https://example.test/`,
      fetch: fetchMock as typeof fetch,
    })

    await api.getSpace({ wikiSpaceId: `wiki_demo` })

    expect(fetchMock).toHaveBeenCalledWith(
      `https://example.test/api/spaces/wiki_demo`,
      { method: `GET` }
    )
  })

  it(`throws LivingWikiApiError for non-2xx JSON errors`, async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ ok: false, error: `Space not found` }, { status: 404 })
    )
    const api = createLivingWikiApiClient({ fetch: fetchMock as typeof fetch })

    await expect(
      api.getSpace({ wikiSpaceId: `wiki_demo` })
    ).rejects.toMatchObject({
      status: 404,
      message: `Space not found`,
    })
    await expect(
      api.getSpace({ wikiSpaceId: `wiki_demo` })
    ).rejects.toBeInstanceOf(LivingWikiApiError)
  })

  it(`throws LivingWikiApiError for invalid successful snapshots`, async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ space: { id: `bad` } }))
    const api = createLivingWikiApiClient({ fetch: fetchMock as typeof fetch })

    await expect(
      api.getSpace({ wikiSpaceId: `wiki_demo` })
    ).rejects.toMatchObject({
      status: 200,
      message: `Invalid space response`,
    })
  })
})
