import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPgSyncStreamPath,
  sourceRefForPgSync,
} from '@electric-ax/agents-runtime'
import {
  buildElectricShapeParams,
  pgSyncMessageToDurableEvent,
  PgSyncBridgeManager,
  PG_SYNC_ELECTRIC_SHAPE_URL,
} from '../src/pg-sync-bridge-manager'

const { mockState } = vi.hoisted(() => ({
  mockState: {
    callbacks: [] as Array<
      (messages: Array<Record<string, unknown>>) => unknown
    >,
    constructedOptions: [] as Array<Record<string, unknown>>,
    appends: [] as string[],
    appendError: null as Error | null,
    streams: [] as Array<{ shapeHandle?: string; lastOffset?: string }>,
  },
}))

vi.mock(`@electric-sql/client`, () => ({
  isControlMessage: (message: { headers?: Record<string, unknown> }) =>
    typeof message.headers?.control === `string`,
  isChangeMessage: (message: { headers?: Record<string, unknown> }) =>
    typeof message.headers?.operation === `string`,
  ShapeStream: class MockShapeStream {
    shapeHandle = `handle-${mockState.streams.length + 1}`
    lastOffset = `1_0`
    constructor(options: Record<string, unknown>) {
      mockState.constructedOptions.push(options)
      mockState.streams.push(this)
    }
    subscribe(
      callback: (messages: Array<Record<string, unknown>>) => unknown
    ): () => void {
      mockState.callbacks.push(callback)
      return () => undefined
    }
  },
}))

vi.mock(`@durable-streams/client`, () => ({
  DurableStream: class MockDurableStream {
    constructor(readonly options: unknown) {}
  },
  IdempotentProducer: class MockIdempotentProducer {
    async append(payload: string): Promise<void> {
      if (mockState.appendError) throw mockState.appendError
      mockState.appends.push(payload)
    }
    async flush(): Promise<void> {}
    async detach(): Promise<void> {}
  },
}))

beforeEach(() => {
  mockState.callbacks = []
  mockState.constructedOptions = []
  mockState.appends = []
  mockState.appendError = null
  mockState.streams = []
})

describe(`pg-sync bridge helpers`, () => {
  it(`builds Electric shape params from JSON-safe options`, () => {
    expect(
      buildElectricShapeParams({
        table: `todos`,
        columns: [`id`, `text`],
        where: `done = $1`,
        params: [`false`],
        replica: `full`,
      })
    ).toEqual({
      table: `todos`,
      columns: [`id`, `text`],
      where: `done = $1`,
      params: [`false`],
      replica: `full`,
    })
  })

  it(`converts insert/update/delete messages with stable keys`, () => {
    const options = { table: `todos` }
    const insert = pgSyncMessageToDurableEvent(
      {
        headers: { operation: `insert`, offset: `1_0` },
        value: { id: 1, text: `a` },
      } as any,
      options
    )!
    const update = pgSyncMessageToDurableEvent(
      {
        headers: { operation: `update`, offset: `2_0` },
        value: { id: 1, text: `b` },
      } as any,
      options
    )!
    const del = pgSyncMessageToDurableEvent(
      {
        headers: { operation: `delete`, offset: `3_0` },
        value: { id: 1 },
      } as any,
      options
    )!

    expect(insert.key).toBe(`${sourceRefForPgSync(options)}:insert:1_0`)
    expect(update.headers.operation).toBe(`update`)
    expect(del.value.operation).toBe(`delete`)
    expect(del.value.rowKey).toBe(`1`)
  })

  it(`falls back to message.key when offset is absent`, () => {
    const options = { table: `todos` }
    const event = pgSyncMessageToDurableEvent(
      {
        key: `shape-key-1`,
        headers: { operation: `insert` },
        value: { id: 1 },
      } as any,
      options
    )!

    expect(event.key).toBe(`${sourceRefForPgSync(options)}:insert:shape-key-1`)
    expect(event.key).not.toContain(`undefined`)
  })

  it(`falls back to a UUID when offset and message.key are absent`, () => {
    const options = { table: `todos` }
    const event = pgSyncMessageToDurableEvent(
      { headers: { operation: `insert` }, value: { id: 1 } } as any,
      options
    )!

    expect(event.key).toMatch(
      new RegExp(`^${sourceRefForPgSync(options)}:insert:[0-9a-f-]{36}$`)
    )
    expect(event.key).not.toContain(`undefined`)
  })

  it(`converts BigInt values to strings so durable events are JSON serializable`, () => {
    const options = { table: `entities` }
    const event = pgSyncMessageToDurableEvent(
      {
        headers: { operation: `insert`, offset: 12n },
        value: { id: 1n, nested: { count: 2n } },
        old_value: { id: 0n },
      } as any,
      options
    )!

    expect(JSON.stringify(event)).toContain(`"1"`)
    expect(event.value.value).toEqual({ id: `1`, nested: { count: `2` } })
    expect(event.value.oldValue).toEqual({ id: `0` })
    expect(event.value.headers).toEqual({ operation: `insert`, offset: `12` })
  })
})

describe(`PgSyncBridgeManager`, () => {
  it(`starts one stream per sourceRef and appends change events`, async () => {
    const streamClient = {
      baseUrl: `http://durable`,
      ensure: vi.fn(async () => undefined),
    }
    const manager = new PgSyncBridgeManager(streamClient as any)

    await manager.register({ table: `todos` })
    await manager.register({ table: `todos` })

    expect(streamClient.ensure).toHaveBeenCalledTimes(2)
    expect(mockState.constructedOptions).toHaveLength(1)
    expect(mockState.constructedOptions[0]).toMatchObject({
      url: PG_SYNC_ELECTRIC_SHAPE_URL,
      params: { table: `todos` },
      offset: `-1`,
    })

    await mockState.callbacks[0]!([{ headers: { control: `up-to-date` } }])
    await mockState.callbacks[0]!([
      { headers: { operation: `insert`, offset: `1_0` }, value: { id: 1 } },
    ])
    expect(JSON.parse(mockState.appends[0]!)).toMatchObject({
      type: `pg_sync_change`,
      headers: { operation: `insert` },
      value: { table: `todos`, operation: `insert`, rowKey: `1` },
    })
  })

  it(`does not append or wake for initial snapshot changes before up-to-date`, async () => {
    const evaluateWakes = vi.fn(async () => undefined)
    const streamClient = {
      baseUrl: `http://durable`,
      ensure: vi.fn(async () => undefined),
    }
    const manager = new PgSyncBridgeManager(streamClient as any, evaluateWakes)

    await manager.register({ table: `todos` })
    await mockState.callbacks[0]!([
      { headers: { operation: `insert`, offset: `1_0` }, value: { id: 1 } },
      { headers: { control: `up-to-date` } },
    ])

    expect(mockState.appends).toEqual([])
    expect(evaluateWakes).not.toHaveBeenCalled()

    await mockState.callbacks[0]!([
      { headers: { operation: `insert`, offset: `2_0` }, value: { id: 2 } },
    ])
    expect(mockState.appends).toHaveLength(1)
    expect(evaluateWakes).toHaveBeenCalledTimes(1)
  })

  it(`invokes wake evaluation with the pgSync stream URL after appending`, async () => {
    const evaluateWakes = vi.fn(async () => undefined)
    const streamClient = {
      baseUrl: `http://durable`,
      ensure: vi.fn(async () => undefined),
    }
    const manager = new PgSyncBridgeManager(streamClient as any, evaluateWakes)
    const options = { table: `todos` }
    const sourceRef = sourceRefForPgSync(options)

    await manager.register(options)
    await mockState.callbacks[0]!([{ headers: { control: `up-to-date` } }])
    await mockState.callbacks[0]!([
      { headers: { operation: `insert`, offset: `1_0` }, value: { id: 1 } },
    ])

    expect(evaluateWakes).toHaveBeenCalledTimes(1)
    expect(evaluateWakes).toHaveBeenCalledWith(
      getPgSyncStreamPath(sourceRef),
      expect.objectContaining({
        type: `pg_sync_change`,
        headers: expect.objectContaining({ operation: `insert` }),
      })
    )
  })

  it(`namespaces pg-sync stream paths by tenant to avoid cross-tenant sharing`, async () => {
    const registry = {
      tenantId: `tenant-a`,
      upsertPgSyncBridge: vi.fn(async (row) => ({ ...row })),
      clearPgSyncBridgeCursor: vi.fn(async () => undefined),
      updatePgSyncBridgeCursor: vi.fn(async () => undefined),
    }
    const manager = new PgSyncBridgeManager(
      {
        baseUrl: `http://durable`,
        ensure: vi.fn(async () => undefined),
      } as any,
      undefined,
      registry as any
    )
    const options = { table: `todos` }
    const sourceRef = sourceRefForPgSync(options)

    const result = await manager.register(options)

    expect(result.streamUrl).toBe(getPgSyncStreamPath(sourceRef, `tenant-a`))
    expect(registry.upsertPgSyncBridge).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceRef,
        streamUrl: getPgSyncStreamPath(sourceRef, `tenant-a`),
      })
    )
  })

  it(`persists registration with canonical options and updates cursor after messages`, async () => {
    const registry = {
      upsertPgSyncBridge: vi.fn(async (row) => ({ ...row })),
      touchPgSyncBridge: vi.fn(async () => undefined),
      clearPgSyncBridgeCursor: vi.fn(async () => undefined),
      updatePgSyncBridgeCursor: vi.fn(async () => undefined),
    }
    const manager = new PgSyncBridgeManager(
      {
        baseUrl: `http://durable`,
        ensure: vi.fn(async () => undefined),
      } as any,
      undefined,
      registry as any
    )
    const options = { table: `todos`, params: { b: `2`, a: `1` } }
    const sourceRef = sourceRefForPgSync(options)

    await manager.register(options)
    expect(registry.upsertPgSyncBridge).toHaveBeenCalledWith({
      sourceRef,
      streamUrl: getPgSyncStreamPath(sourceRef),
      options: {
        table: `todos`,
        params: { a: `1`, b: `2` },
        replica: `default`,
      },
    })

    mockState.streams[0]!.shapeHandle = `shape-handle`
    mockState.streams[0]!.lastOffset = `7_0`
    await mockState.callbacks[0]!([{ headers: { control: `up-to-date` } }])
    await mockState.callbacks[0]!([
      { headers: { operation: `insert`, offset: `7_0` }, value: { id: 1 } },
    ])
    expect(registry.updatePgSyncBridgeCursor).toHaveBeenCalledWith(
      sourceRef,
      `shape-handle`,
      `7_0`
    )
  })

  it(`does not persist cursor when append fails`, async () => {
    const registry = {
      upsertPgSyncBridge: vi.fn(async (row) => ({ ...row })),
      touchPgSyncBridge: vi.fn(async () => undefined),
      clearPgSyncBridgeCursor: vi.fn(async () => undefined),
      updatePgSyncBridgeCursor: vi.fn(async () => undefined),
    }
    const manager = new PgSyncBridgeManager(
      {
        baseUrl: `http://durable`,
        ensure: vi.fn(async () => undefined),
      } as any,
      undefined,
      registry as any
    )

    await manager.register({ table: `todos` })
    await mockState.callbacks[0]!([{ headers: { control: `up-to-date` } }])
    registry.updatePgSyncBridgeCursor.mockClear()
    mockState.appendError = new Error(`append failed`)
    await mockState.callbacks[0]!([
      { headers: { operation: `insert`, offset: `7_0` }, value: { id: 1 } },
    ])

    expect(registry.updatePgSyncBridgeCursor).not.toHaveBeenCalled()
    expect(mockState.constructedOptions).toHaveLength(2)
  })

  it(`startup resumes existing pgSync bridges from stored cursor`, async () => {
    const options = { table: `todos` }
    const sourceRef = sourceRefForPgSync(options)
    const registry = {
      listPgSyncBridges: vi.fn(async () => [
        {
          sourceRef,
          streamUrl: getPgSyncStreamPath(sourceRef),
          options,
          shapeHandle: `handle-1`,
          shapeOffset: `12_0`,
        },
      ]),
    }
    const streamClient = {
      baseUrl: `http://durable`,
      ensure: vi.fn(async () => undefined),
    }
    const manager = new PgSyncBridgeManager(
      streamClient as any,
      undefined,
      registry as any
    )

    await manager.start()
    await manager.start()

    expect(mockState.constructedOptions).toHaveLength(1)
    expect(mockState.constructedOptions[0]).toMatchObject({
      offset: `12_0`,
      handle: `handle-1`,
    })
  })

  it(`invalid stored shape cursor falls back to bootstrap and clears cursor`, async () => {
    const options = { table: `todos` }
    const sourceRef = sourceRefForPgSync(options)
    const registry = {
      listPgSyncBridges: vi.fn(async () => [
        {
          sourceRef,
          streamUrl: getPgSyncStreamPath(sourceRef),
          options,
          shapeHandle: `handle-1`,
          shapeOffset: `not-valid`,
        },
      ]),
      clearPgSyncBridgeCursor: vi.fn(async () => undefined),
    }
    const manager = new PgSyncBridgeManager(
      {
        baseUrl: `http://durable`,
        ensure: vi.fn(async () => undefined),
      } as any,
      undefined,
      registry as any
    )

    await manager.start()

    expect(mockState.constructedOptions[0]).toMatchObject({ offset: `-1` })
    expect(mockState.constructedOptions[0]).not.toHaveProperty(`handle`)
    expect(registry.clearPgSyncBridgeCursor).toHaveBeenCalledWith(sourceRef)
  })

  it(`must-refetch clears persisted cursor and restarts bootstrap`, async () => {
    const options = { table: `todos` }
    const sourceRef = sourceRefForPgSync(options)
    const registry = {
      upsertPgSyncBridge: vi.fn(async (row) => ({ ...row })),
      touchPgSyncBridge: vi.fn(async () => undefined),
      clearPgSyncBridgeCursor: vi.fn(async () => undefined),
    }
    const manager = new PgSyncBridgeManager(
      {
        baseUrl: `http://durable`,
        ensure: vi.fn(async () => undefined),
      } as any,
      undefined,
      registry as any
    )
    await manager.register(options)

    await mockState.callbacks[0]!([{ headers: { control: `must-refetch` } }])

    expect(registry.clearPgSyncBridgeCursor).toHaveBeenCalledWith(sourceRef)
    expect(mockState.constructedOptions).toHaveLength(2)
    expect(mockState.constructedOptions[1]!.offset).toBe(`-1`)
    expect(mockState.constructedOptions[1]).not.toHaveProperty(`handle`)
  })

  it(`restarts from -1 on must-refetch`, async () => {
    const manager = new PgSyncBridgeManager({
      baseUrl: `http://durable`,
      ensure: vi.fn(async () => undefined),
    } as any)
    await manager.register({ table: `todos` })

    await mockState.callbacks[0]!([{ headers: { control: `must-refetch` } }])

    expect(mockState.constructedOptions).toHaveLength(2)
    expect(mockState.constructedOptions[1]!.offset).toBe(`-1`)
  })
})
