import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getPgSyncStreamPath,
  sourceRefForPgSync,
} from '@electric-ax/agents-runtime'
import {
  buildElectricShapeParams,
  pgSyncMessageToDurableEvent,
  PgSyncBridgeManager,
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

const SHAPE_URL = `https://electric.example/v1/shape`

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
        url: `https://electric.example/v1/shape`,
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
    const options = { url: SHAPE_URL, table: `todos` }
    const insert = pgSyncMessageToDurableEvent(
      {
        headers: { operation: `insert`, lsn: `1`, op_position: 0 },
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

  it(`derives an offset from lsn and op_position when Electric omits headers.offset`, () => {
    const options = { url: SHAPE_URL, table: `todos` }

    const event = pgSyncMessageToDurableEvent(
      {
        headers: { operation: `insert`, lsn: `28517568`, op_position: 0 },
        value: { id: 32, text: `testing` },
      } as any,
      options
    )!

    expect(event.key).toBe(`${sourceRefForPgSync(options)}:insert:28517568_0`)
    expect(event.value.offset).toBe(`28517568_0`)
  })

  it(`rejects messages without stable offsets or lsn/op_position`, () => {
    const options = { url: SHAPE_URL, table: `todos` }

    expect(
      pgSyncMessageToDurableEvent(
        {
          key: `shape-key-1`,
          headers: { operation: `insert` },
          value: { id: 1 },
        } as any,
        options
      )
    ).toBeNull()
    expect(
      pgSyncMessageToDurableEvent(
        {
          headers: { operation: `insert`, lsn: `28517568` },
          value: { id: 1 },
        } as any,
        options
      )
    ).toBeNull()
  })

  it(`converts BigInt values to strings so durable events are JSON serializable`, () => {
    const options = { url: SHAPE_URL, table: `entities` }
    const event = pgSyncMessageToDurableEvent(
      {
        headers: { operation: `insert`, offset: `12_0` },
        value: { id: 1n, nested: { count: 2n } },
        old_value: { id: 0n },
      } as any,
      options
    )!

    expect(JSON.stringify(event)).toContain(`"1"`)
    expect(event.value.value).toEqual({ id: `1`, nested: { count: `2` } })
    expect(event.value.oldValue).toEqual({ id: `0` })
    expect(event.value.headers).toEqual({ operation: `insert`, offset: `12_0` })
  })
})

describe(`PgSyncBridgeManager`, () => {
  it(`requires a source URL at registration time`, async () => {
    const manager = new PgSyncBridgeManager({
      baseUrl: `http://durable`,
      ensure: vi.fn(async () => undefined),
    } as any)

    await expect(manager.register({ table: `todos` })).rejects.toThrow(
      /pgSync source url is required/
    )
  })

  it(`starts one stream per sourceRef and appends change events`, async () => {
    const streamClient = {
      baseUrl: `http://durable`,
      ensure: vi.fn(async () => undefined),
    }
    const manager = new PgSyncBridgeManager(streamClient as any)

    await manager.register({ url: SHAPE_URL, table: `todos` })
    await manager.register({ url: SHAPE_URL, table: `todos` })

    expect(streamClient.ensure).toHaveBeenCalledTimes(2)
    expect(mockState.constructedOptions).toHaveLength(1)
    expect(mockState.constructedOptions[0]).toMatchObject({
      url: SHAPE_URL,
      params: { table: `todos` },
      offset: `now`,
      log: `changes_only`,
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

    await manager.register({ url: SHAPE_URL, table: `todos` })
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
    const options = { url: SHAPE_URL, table: `todos` }
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
    const options = { url: SHAPE_URL, table: `todos` }
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
    const options = {
      url: SHAPE_URL,
      table: `todos`,
      params: { b: `2`, a: `1` },
    }
    const sourceRef = sourceRefForPgSync(options)

    await manager.register(options)
    expect(registry.upsertPgSyncBridge).toHaveBeenCalledWith({
      sourceRef,
      streamUrl: getPgSyncStreamPath(sourceRef),
      options: {
        url: SHAPE_URL,
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
      `7_0`,
      true
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

    await manager.register({ url: SHAPE_URL, table: `todos` })
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
    const options = { url: SHAPE_URL, table: `todos` }
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
    const options = { url: SHAPE_URL, table: `todos` }
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

    expect(mockState.constructedOptions[0]).toMatchObject({
      offset: `now`,
      log: `changes_only`,
    })
    expect(mockState.constructedOptions[0]).not.toHaveProperty(`handle`)
    expect(registry.clearPgSyncBridgeCursor).toHaveBeenCalledWith(sourceRef)
  })

  it(`must-refetch clears persisted cursor and restarts bootstrap`, async () => {
    const options = { url: SHAPE_URL, table: `todos` }
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
    expect(mockState.constructedOptions[1]).toMatchObject({
      offset: `now`,
      log: `changes_only`,
    })
    expect(mockState.constructedOptions[1]).not.toHaveProperty(`handle`)
  })

  it(`restarts from now on must-refetch`, async () => {
    const manager = new PgSyncBridgeManager({
      baseUrl: `http://durable`,
      ensure: vi.fn(async () => undefined),
    } as any)
    await manager.register({ url: SHAPE_URL, table: `todos` })

    await mockState.callbacks[0]!([{ headers: { control: `must-refetch` } }])

    expect(mockState.constructedOptions).toHaveLength(2)
    expect(mockState.constructedOptions[1]).toMatchObject({
      offset: `now`,
      log: `changes_only`,
    })
  })
})

describe(`external review red tests`, () => {
  it(`continues skipping bootstrap snapshot rows after restart before up-to-date`, async () => {
    const registryRows = new Map<string, any>()
    const registry = {
      tenantId: `default`,
      upsertPgSyncBridge: vi.fn(async (row) => {
        const existing = registryRows.get(row.sourceRef)
        const next = { ...existing, ...row }
        registryRows.set(row.sourceRef, next)
        return next
      }),
      clearPgSyncBridgeCursor: vi.fn(async (sourceRef) => {
        const row = registryRows.get(sourceRef)
        if (row) {
          row.shapeHandle = undefined
          row.shapeOffset = undefined
        }
      }),
      updatePgSyncBridgeCursor: vi.fn(
        async (sourceRef, shapeHandle, shapeOffset) => {
          const row = registryRows.get(sourceRef)
          if (row) {
            row.shapeHandle = shapeHandle
            row.shapeOffset = shapeOffset
          }
        }
      ),
      listPgSyncBridges: vi.fn(async () => [...registryRows.values()]),
    }
    const streamClient = {
      baseUrl: `http://durable`,
      ensure: vi.fn(async () => undefined),
    }

    const first = new PgSyncBridgeManager(
      streamClient as any,
      undefined,
      registry as any
    )
    await first.register({ url: SHAPE_URL, table: `todos` })
    mockState.streams[0]!.shapeHandle = `shape-a`
    mockState.streams[0]!.lastOffset = `1_0`
    await mockState.callbacks[0]!([
      { headers: { operation: `insert`, offset: `1_0` }, value: { id: 1 } },
    ])
    expect(mockState.appends).toEqual([])
    await first.stop()

    const second = new PgSyncBridgeManager(
      streamClient as any,
      undefined,
      registry as any
    )
    await second.start()
    await mockState.callbacks[1]!([
      { headers: { operation: `insert`, offset: `2_0` }, value: { id: 2 } },
      { headers: { control: `up-to-date` } },
    ])

    expect(mockState.appends).toEqual([])
  })

  it(`recovers from append failure using last committed cursor, not received stream offset`, async () => {
    const registry = {
      tenantId: `default`,
      upsertPgSyncBridge: vi.fn(async (row) => ({ ...row })),
      clearPgSyncBridgeCursor: vi.fn(async () => undefined),
      updatePgSyncBridgeCursor: vi.fn(async () => undefined),
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

    await manager.register({ url: SHAPE_URL, table: `todos` })
    await mockState.callbacks[0]!([{ headers: { control: `up-to-date` } }])
    mockState.streams[0]!.shapeHandle = `shape-a`
    mockState.streams[0]!.lastOffset = `2_0`
    mockState.appendError = new Error(`append failed`)
    await mockState.callbacks[0]!([
      { headers: { operation: `insert`, offset: `1_0` }, value: { id: 1 } },
      { headers: { operation: `insert`, offset: `2_0` }, value: { id: 2 } },
    ])

    expect(mockState.constructedOptions.at(-1)).toMatchObject({
      offset: `1_0`,
    })
  })

  it(`rejects pg-sync change messages without a stable per-change offset`, () => {
    expect(
      pgSyncMessageToDurableEvent(
        { headers: { operation: `insert` }, value: { id: 1 } } as any,
        { url: SHAPE_URL, table: `todos` }
      )
    ).toBeNull()
  })
})

describe(`pg-sync production hardening`, () => {
  it(`uses the source URL from registration options and forwards request metadata as shape params`, async () => {
    const manager = new PgSyncBridgeManager(
      {
        baseUrl: `http://durable`,
        ensure: vi.fn(async () => undefined),
      } as any,
      undefined,
      undefined,
      {
        retry: { initialDelayMs: 0, maxDelayMs: 0 },
      }
    )

    await manager.register(
      { url: SHAPE_URL, table: `todos` },
      {
        tenantId: `tenant-a`,
        principalKind: `agent`,
        principalId: `horton`,
        principalKey: `agent:horton`,
        principalUrl: `/principal/agent%3Ahorton`,
        entityUrl: `/horton/abc`,
        entityType: `horton`,
        streamPath: `/horton/abc/main`,
        runtimeConsumerId: `runner-1`,
        wakeId: `wake-1`,
      }
    )

    expect(mockState.constructedOptions[0]).toMatchObject({
      url: SHAPE_URL,
      params: {
        table: `todos`,
        replica: `default`,
        electric_agents_tenant_id: `tenant-a`,
        electric_agents_principal_kind: `agent`,
        electric_agents_principal_id: `horton`,
        electric_agents_principal_key: `agent:horton`,
        electric_agents_principal_url: `/principal/agent%3Ahorton`,
        electric_agents_entity_url: `/horton/abc`,
        electric_agents_entity_type: `horton`,
        electric_agents_stream_path: `/horton/abc/main`,
        electric_agents_runtime_consumer_id: `runner-1`,
        electric_agents_wake_id: `wake-1`,
      },
    })
  })

  it(`backs off before recovery retries`, async () => {
    const sleeps: number[] = []
    const manager = new PgSyncBridgeManager(
      {
        baseUrl: `http://durable`,
        ensure: vi.fn(async () => undefined),
      } as any,
      undefined,
      undefined,
      {
        retry: {
          initialDelayMs: 10,
          maxDelayMs: 10,
          random: () => 0,
          sleep: async (ms) => {
            sleeps.push(ms)
          },
        },
      }
    )

    await manager.register({ url: SHAPE_URL, table: `todos` })
    await mockState.callbacks[0]!([{ headers: { control: `up-to-date` } }])
    mockState.appendError = new Error(`append failed`)
    await mockState.callbacks[0]!([
      { headers: { operation: `insert`, offset: `1_0` }, value: { id: 1 } },
    ])

    expect(sleeps).toEqual([10])
  })
})
