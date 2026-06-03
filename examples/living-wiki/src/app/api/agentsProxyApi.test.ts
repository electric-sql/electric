import { describe, expect, it } from 'vitest'
import { getEntityStreamUrl, getObserveUrl } from './agentsProxyApi'

describe(`getEntityStreamUrl`, () => {
  it(`produces the correct entity stream path`, () => {
    const url = getEntityStreamUrl({
      wikiSpaceId: `wiki_demo`,
      entityKind: `wiki-space`,
      entityId: `entity_123`,
    })

    expect(url).toBe(
      `/api/agents/entities/wiki_demo/wiki-space/entity_123/stream`
    )
  })

  it(`encodes special characters in IDs`, () => {
    const url = getEntityStreamUrl({
      wikiSpaceId: `space with spaces`,
      entityKind: `wiki-space`,
      entityId: `id/with/slashes`,
    })

    expect(url).toBe(
      `/api/agents/entities/space%20with%20spaces/wiki-space/id%2Fwith%2Fslashes/stream`
    )
  })

  it(`can include demo actor context as query params`, () => {
    const url = getEntityStreamUrl(
      {
        wikiSpaceId: `wiki_demo`,
        entityKind: `wiki-space`,
        entityId: `entity_123`,
      },
      { actorId: `actor_ada` }
    )

    expect(url).toBe(
      `/api/agents/entities/wiki_demo/wiki-space/entity_123/stream?actorId=actor_ada`
    )
  })
})

describe(`getObserveUrl`, () => {
  it(`produces the correct path for entities observe kind`, () => {
    const url = getObserveUrl({
      wikiSpaceId: `wiki_demo`,
      observeKind: `entities`,
    })

    expect(url).toBe(`/api/observe/wiki_demo/entities`)
  })

  it(`produces the correct path for shared-state observe kind`, () => {
    const url = getObserveUrl({
      wikiSpaceId: `wiki_demo`,
      observeKind: `shared-state`,
    })

    expect(url).toBe(`/api/observe/wiki_demo/shared-state`)
  })

  it(`appends protocol params when provided as a plain object`, () => {
    const url = getObserveUrl(
      { wikiSpaceId: `wiki_demo`, observeKind: `entities` },
      { offset: `0`, live: `true` }
    )

    expect(url).toBe(`/api/observe/wiki_demo/entities?offset=0&live=true`)
  })

  it(`appends protocol params when provided as URLSearchParams`, () => {
    const params = new URLSearchParams()
    params.set(`cursor`, `abc123`)
    params.set(`live`, `false`)

    const url = getObserveUrl(
      { wikiSpaceId: `wiki_demo`, observeKind: `shared-state` },
      params
    )

    expect(url).toBe(
      `/api/observe/wiki_demo/shared-state?cursor=abc123&live=false`
    )
  })

  it(`omits query string when protocol params are empty`, () => {
    const url = getObserveUrl(
      { wikiSpaceId: `wiki_demo`, observeKind: `entities` },
      {}
    )

    expect(url).toBe(`/api/observe/wiki_demo/entities`)
  })
})

describe(`no upstream leaks`, () => {
  it(`getEntityStreamUrl does not reference upstream URLs or tokens`, () => {
    const url = getEntityStreamUrl({
      wikiSpaceId: `wiki_demo`,
      entityKind: `wiki-space`,
      entityId: `entity_1`,
    })

    expect(url).not.toContain(`agents.example`)
    expect(url).not.toContain(`token`)
    expect(url).not.toContain(`://`)
    expect(url.startsWith(`/`)).toBe(true)
  })

  it(`getObserveUrl does not reference upstream URLs or tokens`, () => {
    const url = getObserveUrl(
      { wikiSpaceId: `wiki_demo`, observeKind: `entities` },
      { offset: `0` }
    )

    expect(url).not.toContain(`agents.example`)
    expect(url).not.toContain(`token`)
    expect(url).not.toContain(`://`)
    expect(url.startsWith(`/`)).toBe(true)
  })
})
