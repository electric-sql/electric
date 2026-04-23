import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentsClient } from '../src/agents-client'
import { cron, entities } from '../src/observation-sources'
import type * as StateModule from '@durable-streams/state'

const { mockState } = vi.hoisted(() => ({
  mockState: {
    registerEntitiesSource: vi.fn(),
    registerCronSource: vi.fn(),
    createStreamDB: vi.fn(),
    preload: vi.fn(),
    observedDb: {
      preload: vi.fn(),
      collections: {
        members: {},
      },
    },
  },
}))

vi.mock(`../src/runtime-server-client`, () => ({
  createRuntimeServerClient: () => ({
    registerEntitiesSource: mockState.registerEntitiesSource,
    registerCronSource: mockState.registerCronSource,
  }),
}))

vi.mock(`@durable-streams/state`, async (importOriginal) => {
  const actual = await importOriginal<typeof StateModule>()
  return {
    ...actual,
    createStreamDB: (options: Record<string, unknown>) => {
      mockState.createStreamDB(options)
      return mockState.observedDb
    },
  }
})

describe(`createAgentsClient`, () => {
  beforeEach(() => {
    mockState.registerEntitiesSource = vi.fn().mockResolvedValue({
      sourceRef: `source-1`,
      streamUrl: `/_entities/source-1`,
    })
    mockState.createStreamDB = vi.fn()
    mockState.observedDb = {
      preload: vi.fn().mockResolvedValue(undefined),
      collections: {
        members: {},
      },
    }
  })

  it(`observe(cron(...)) throws a clear error (not the generic guard)`, async () => {
    mockState.registerCronSource = vi.fn().mockResolvedValue(`/_cron/abc123`)

    const client = createAgentsClient({
      baseUrl: `http://agents.test`,
    })

    const source = cron(`0 9 * * *`)

    // Cron observation isn't fully implemented yet, but the error should
    // be explicit — not the confusing "without a streamUrl and schema" guard.
    await expect(client.observe(source)).rejects.toThrow(
      /cron.*not.*supported|not.*implemented/i
    )
  })

  it(`registers entities sources and returns a preloaded StreamDB`, async () => {
    const client = createAgentsClient({
      baseUrl: `http://electric-agents.test`,
    })

    const source = entities({
      tags: {
        role: `reviewer`,
        demo_id: `X`,
      },
    })

    const db = await client.observe(source)

    expect(mockState.registerEntitiesSource).toHaveBeenCalledWith({
      demo_id: `X`,
      role: `reviewer`,
    })
    expect(mockState.createStreamDB).toHaveBeenCalledWith({
      streamOptions: {
        url: `http://electric-agents.test${source.streamUrl}`,
        contentType: `application/json`,
      },
      state: source.schema,
    })
    expect(mockState.observedDb.preload).toHaveBeenCalledOnce()
    expect(db).toBe(mockState.observedDb)
  })
})
