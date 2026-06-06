import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentsClient } from '../src/agents-client'
import { cron, entities, pgSync, webhook } from '../src/observation-sources'
import type * as StateDbModule from '@durable-streams/state/db'

const { mockState } = vi.hoisted(() => ({
  mockState: {
    ensureEntitiesMembershipStream: vi.fn(),
    ensureCronStream: vi.fn(),
    registerPgSyncSource: vi.fn(),
    signalEntity: vi.fn(),
    ensureStream: vi.fn(),
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
    ensureEntitiesMembershipStream: mockState.ensureEntitiesMembershipStream,
    ensureCronStream: mockState.ensureCronStream,
    registerPgSyncSource: mockState.registerPgSyncSource,
    signalEntity: mockState.signalEntity,
    ensureStream: mockState.ensureStream,
  }),
}))

vi.mock(`@durable-streams/state/db`, async (importOriginal) => {
  const actual = await importOriginal<typeof StateDbModule>()
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
    mockState.ensureEntitiesMembershipStream = vi.fn().mockResolvedValue({
      sourceRef: `source-1`,
      streamUrl: `/_entities/source-1`,
    })
    mockState.registerPgSyncSource = vi.fn().mockResolvedValue({
      sourceRef: `pg-source-1`,
      streamUrl: `/_electric/pg-sync/pg-source-1`,
    })
    mockState.ensureStream = vi.fn().mockResolvedValue(`/_webhooks/repo`)
    mockState.createStreamDB = vi.fn()
    mockState.signalEntity = vi.fn().mockResolvedValue({ txid: 123 })
    mockState.observedDb = {
      preload: vi.fn().mockResolvedValue(undefined),
      collections: {
        members: {},
      },
    }
  })

  it(`observe(cron(...)) throws a clear error (not the generic guard)`, async () => {
    mockState.ensureCronStream = vi.fn().mockResolvedValue(`/_cron/abc123`)

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

  it(`ensures entities membership streams and returns a preloaded StreamDB`, async () => {
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

    expect(mockState.ensureEntitiesMembershipStream).toHaveBeenCalledWith({
      demo_id: `X`,
      role: `reviewer`,
    })
    expect(mockState.createStreamDB).toHaveBeenCalledWith({
      streamOptions: {
        url: `http://electric-agents.test/_entities/source-1`,
        contentType: `application/json`,
      },
      state: source.schema,
    })
    expect(mockState.observedDb.preload).toHaveBeenCalledOnce()
    expect(db).toBe(mockState.observedDb)
  })

  it(`registers pgSync sources before preloading the observed StreamDB`, async () => {
    const client = createAgentsClient({
      baseUrl: `http://electric-agents.test`,
    })

    const source = pgSync({
      table: `todos`,
      where: `priority = $1`,
      params: [`high`],
      replica: `full`,
    })

    const db = await client.observe(source)

    expect(mockState.registerPgSyncSource).toHaveBeenCalledWith(source.options)
    expect(mockState.createStreamDB).toHaveBeenCalledWith({
      streamOptions: {
        url: `http://electric-agents.test${source.streamUrl}`,
        contentType: `application/json`,
      },
      state: expect.objectContaining({
        changes: expect.objectContaining({
          type: `pg_sync_change`,
          primaryKey: `key`,
        }),
      }),
    })
    expect(mockState.observedDb.preload).toHaveBeenCalledOnce()
    expect(
      mockState.registerPgSyncSource.mock.invocationCallOrder[0]
    ).toBeLessThan(mockState.observedDb.preload.mock.invocationCallOrder[0])
    expect(db).toBe(mockState.observedDb)
  })

  it(`preserves tenant path prefixes on observed stream URLs`, async () => {
    const client = createAgentsClient({
      baseUrl: `http://electric-agents.test/t/tenant-a/v1`,
    })

    const source = entities({
      tags: {
        role: `reviewer`,
      },
    })

    await client.observe(source)

    expect(mockState.createStreamDB).toHaveBeenCalledWith({
      streamOptions: {
        url: `http://electric-agents.test/t/tenant-a/v1/_entities/source-1`,
        contentType: `application/json`,
      },
      state: source.schema,
    })
  })

  it(`exposes signal and kill helpers through the server client`, async () => {
    const client = createAgentsClient({
      baseUrl: `http://electric-agents.test`,
    })

    await expect(
      client.signal({
        entityUrl: `/chat/demo`,
        signal: `SIGINT`,
        reason: `stop`,
      })
    ).resolves.toEqual({ txid: 123 })

    await client.kill(`/chat/demo`, `cleanup`)

    expect(mockState.signalEntity).toHaveBeenNthCalledWith(1, {
      entityUrl: `/chat/demo`,
      signal: `SIGINT`,
      reason: `stop`,
    })
    expect(mockState.signalEntity).toHaveBeenNthCalledWith(2, {
      entityUrl: `/chat/demo`,
      signal: `SIGKILL`,
      reason: `cleanup`,
    })
  })

  it(`observe(webhook(...)) ensures the exact stream before preloading it`, async () => {
    const client = createAgentsClient({
      baseUrl: `http://electric-agents.test/t/tenant-a/v1`,
    })

    const source = webhook(`repo`, { bucket: `prs/123` })

    const db = await client.observe(source)

    expect(mockState.ensureStream).toHaveBeenCalledWith(
      `/_webhooks/repo/prs/123`,
      `application/json`
    )
    expect(mockState.createStreamDB).toHaveBeenCalledWith({
      streamOptions: {
        url: `http://electric-agents.test/t/tenant-a/v1/_webhooks/repo/prs/123`,
        contentType: `application/json`,
      },
      state: source.schema,
    })
    expect(mockState.ensureStream.mock.invocationCallOrder[0]).toBeLessThan(
      mockState.createStreamDB.mock.invocationCallOrder[0]!
    )
    expect(mockState.observedDb.preload).toHaveBeenCalledOnce()
    expect(db).toBe(mockState.observedDb)
  })
})
