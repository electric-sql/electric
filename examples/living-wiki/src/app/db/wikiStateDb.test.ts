import { describe, expect, it, vi } from 'vitest'
import { livingWikiStateSchema } from '../../shared/wiki-state'
import {
  createLivingWikiStateDb,
  type LivingWikiStateDbCreateOptions,
} from './wikiStateDb'

const createFakeStreamDB = <T>(db: T) =>
  vi.fn((_: LivingWikiStateDbCreateOptions) => db)

describe(`createLivingWikiStateDb`, () => {
  it(`creates a stream DB for the Worker-proxied shared-state URL`, () => {
    const fakeDb = { collections: {}, preload: vi.fn() }
    const createStreamDB = createFakeStreamDB(fakeDb)

    const db = createLivingWikiStateDb(
      { wikiSpaceId: `wiki_demo` },
      { createStreamDB }
    )

    expect(db).toBe(fakeDb)
    expect(createStreamDB).toHaveBeenCalledTimes(1)
    expect(createStreamDB).toHaveBeenCalledWith({
      streamOptions: {
        url: `/api/observe/wiki_demo/shared-state`,
        contentType: `application/json`,
      },
      state: livingWikiStateSchema,
    })
  })

  it(`rejects invalid wikiSpaceId values before creating the DB`, () => {
    const createStreamDB = vi.fn()

    expect(() =>
      createLivingWikiStateDb(
        { wikiSpaceId: `space/../secret` },
        { createStreamDB }
      )
    ).toThrow()

    expect(() =>
      createLivingWikiStateDb({ wikiSpaceId: `space_demo` }, { createStreamDB })
    ).toThrow()
    expect(createStreamDB).not.toHaveBeenCalled()
  })

  it(`does not expose upstream shared-state internals in helper output or config`, () => {
    const fakeDb = { collections: {}, preload: vi.fn() }
    const createStreamDB = createFakeStreamDB(fakeDb)

    const db = createLivingWikiStateDb(
      { wikiSpaceId: `wiki_demo` },
      { createStreamDB }
    )

    const serialized = JSON.stringify({
      db,
      config: createStreamDB.mock.calls[0]?.[0],
    })

    expect(serialized).not.toContain(`/_electric/shared-state`)
    expect(serialized).not.toContain(`ELECTRIC_AGENTS_BASE_URL`)
    expect(serialized).not.toContain(`ELECTRIC_AGENTS_TOKEN`)
    expect(serialized).not.toContain(`ELECTRIC_AGENTS_PRINCIPAL_KEY`)
    expect(serialized).not.toContain(`living-wiki:`)
  })

  it(`does not preload the stream`, () => {
    const fakeDb = { collections: {}, preload: vi.fn() }
    const createStreamDB = createFakeStreamDB(fakeDb)

    createLivingWikiStateDb({ wikiSpaceId: `wiki_demo` }, { createStreamDB })

    expect(fakeDb.preload).not.toHaveBeenCalled()
  })
})
