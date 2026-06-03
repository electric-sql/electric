import { describe, expect, it, vi } from 'vitest'

import { livingWikiStateCollections } from '../../shared/wiki-state'
import { deriveLivingWikiSharedStateId } from '../../shared/wiki-state-ids'
import {
  getWikiSpaceRuntimeIds,
  registerWikiSpace,
  WIKI_SPACE_ENTITY_TYPE,
  wikiSpaceCreationSchema,
} from './wiki-space'

describe(`WikiSpace entity scaffold`, () => {
  it(`registers the wiki_space entity with description, schema, and handler`, () => {
    const registry = makeFakeRegistry()

    registerWikiSpace(registry as never)

    const entry = registry.get(WIKI_SPACE_ENTITY_TYPE)
    expect(entry?.name).toBe(WIKI_SPACE_ENTITY_TYPE)
    expect(entry?.definition.description).toMatch(/inert/i)
    expect(entry?.definition.creationSchema).toBe(wikiSpaceCreationSchema)
    expect(entry?.definition.handler).toEqual(expect.any(Function))
  })

  it(`parses valid creation args and rejects invalid wiki space ids`, () => {
    expect(
      wikiSpaceCreationSchema.parse({ wikiSpaceId: `wiki_demo-1` })
    ).toEqual({
      wikiSpaceId: `wiki_demo-1`,
    })

    expect(() =>
      wikiSpaceCreationSchema.parse({ wikiSpaceId: `space_demo` })
    ).toThrow()
    expect(() =>
      wikiSpaceCreationSchema.parse({ wikiSpaceId: `wiki_` })
    ).toThrow()
    expect(() =>
      wikiSpaceCreationSchema.parse({ wikiSpaceId: `wiki_demo`, extra: true })
    ).toThrow()
  })

  it(`derives stable runtime ids from the shared contract`, () => {
    expect(getWikiSpaceRuntimeIds(`wiki_demo`)).toEqual({
      wikiSpaceId: `wiki_demo`,
      entityUrl: `/wiki_space/wiki_demo`,
      sharedStateId: deriveLivingWikiSharedStateId(`wiki_demo`),
    })
  })

  it(`runs the first-wake handler without hidden agent, send, spawn, or row write calls`, async () => {
    const registry = makeFakeRegistry()
    registerWikiSpace(registry as never)
    const handler = registry.get(WIKI_SPACE_ENTITY_TYPE)?.definition.handler
    expect(handler).toBeDefined()

    const fakeDb = makeFakeSharedStateDb()
    const ctx = {
      args: { wikiSpaceId: `wiki_demo` },
      firstWake: true,
      mkdb: vi.fn(() => fakeDb),
      sleep: vi.fn(),
      useAgent: vi.fn(() => {
        throw new Error(`useAgent must not be called`)
      }),
      spawn: vi.fn(() => {
        throw new Error(`spawn must not be called`)
      }),
      send: vi.fn(() => {
        throw new Error(`send must not be called`)
      }),
    }

    await handler?.(ctx as never, { type: `test`, source: `test` } as never)

    expect(ctx.mkdb).toHaveBeenCalledWith(
      `living-wiki:wiki_demo`,
      livingWikiStateCollections
    )
    expect(ctx.sleep).toHaveBeenCalledTimes(1)
    expect(ctx.useAgent).not.toHaveBeenCalled()
    expect(ctx.spawn).not.toHaveBeenCalled()
    expect(ctx.send).not.toHaveBeenCalled()
    expectNoSharedStateWrites(fakeDb)
  })

  it(`does not create shared state after first wake`, async () => {
    const registry = makeFakeRegistry()
    registerWikiSpace(registry as never)
    const handler = registry.get(WIKI_SPACE_ENTITY_TYPE)?.definition.handler
    const ctx = {
      args: { wikiSpaceId: `wiki_demo` },
      firstWake: false,
      mkdb: vi.fn(),
      sleep: vi.fn(),
    }

    await handler?.(ctx as never, { type: `test`, source: `test` } as never)

    expect(ctx.mkdb).not.toHaveBeenCalled()
    expect(ctx.sleep).toHaveBeenCalledTimes(1)
  })
})

function makeFakeSharedStateDb() {
  return Object.fromEntries(
    Object.keys(livingWikiStateCollections).map((name) => [
      name,
      {
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    ])
  )
}

function expectNoSharedStateWrites(fakeDb: Record<string, unknown>) {
  for (const collection of Object.values(fakeDb)) {
    const writable = collection as {
      insert: ReturnType<typeof vi.fn>
      update: ReturnType<typeof vi.fn>
      delete: ReturnType<typeof vi.fn>
    }
    expect(writable.insert).not.toHaveBeenCalled()
    expect(writable.update).not.toHaveBeenCalled()
    expect(writable.delete).not.toHaveBeenCalled()
  }
}

type FakeEntityDefinition = {
  description?: string
  creationSchema?: unknown
  handler?: (ctx: never, wake: never) => void | Promise<void>
}

type FakeRegistry = {
  define: ReturnType<typeof vi.fn>
  get: (
    name: string
  ) => { name: string; definition: FakeEntityDefinition } | undefined
}

function makeFakeRegistry(): FakeRegistry {
  const entries = new Map<
    string,
    { name: string; definition: FakeEntityDefinition }
  >()
  return {
    define: vi.fn((name: string, definition: FakeEntityDefinition) => {
      entries.set(name, { name, definition })
    }),
    get: (name: string) => entries.get(name),
  }
}
