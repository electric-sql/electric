import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EntityBridgeManager } from '../src/entity-bridge-manager'

const { mockState } = vi.hoisted(() => ({
  mockState: {
    liveCallback: null as
      | null
      | ((messages: Array<Record<string, unknown>>) => Promise<void> | void),
    liveCallbacks: [] as Array<
      (messages: Array<Record<string, unknown>>) => Promise<void> | void
    >,
    producerAppends: [] as Array<{ producerId: string; payload: string }>,
    producerFlushes: [] as Array<string>,
    producerDetaches: [] as Array<string>,
    liveShapeHandle: `live-handle`,
    liveLastOffset: `9_0`,
    lastConstructedOptions: null as null | Record<string, unknown>,
    constructedOptions: [] as Array<Record<string, unknown>>,
  },
}))

vi.mock(`@electric-sql/client`, () => ({
  isControlMessage: (message: { headers?: Record<string, unknown> }) =>
    typeof message.headers?.control === `string`,
  isChangeMessage: (message: { headers?: Record<string, unknown> }) =>
    typeof message.headers?.operation === `string`,
  ShapeStream: class MockShapeStream {
    shapeHandle = mockState.liveShapeHandle
    lastOffset = mockState.liveLastOffset

    constructor(options: Record<string, unknown>) {
      mockState.lastConstructedOptions = options
      mockState.constructedOptions.push(options)
    }

    subscribe(
      callback: (messages: Array<Record<string, unknown>>) => Promise<void>,
      _onError?: (error: Error) => void
    ): () => void {
      mockState.liveCallback = callback
      mockState.liveCallbacks.push(callback)
      return () => {
        mockState.liveCallback = null
      }
    }
  },
}))

vi.mock(`@durable-streams/client`, () => ({
  DurableStream: class MockDurableStream {
    url: string
    contentType?: string

    constructor(options: { url: string; contentType?: string }) {
      this.url = options.url
      this.contentType = options.contentType
    }
  },
  IdempotentProducer: class MockIdempotentProducer {
    constructor(
      _stream: unknown,
      private producerId: string
    ) {}

    append(payload: string): void {
      mockState.producerAppends.push({ producerId: this.producerId, payload })
    }

    async flush(): Promise<void> {
      mockState.producerFlushes.push(this.producerId)
    }

    async detach(): Promise<void> {
      mockState.producerDetaches.push(this.producerId)
    }
  },
}))

describe(`EntityBridgeManager`, () => {
  beforeEach(() => {
    mockState.liveCallback = null
    mockState.liveCallbacks = []
    mockState.producerAppends = []
    mockState.producerFlushes = []
    mockState.producerDetaches = []
    mockState.liveShapeHandle = `live-handle`
    mockState.liveLastOffset = `9_0`
    mockState.lastConstructedOptions = null
    mockState.constructedOptions = []
  })

  it(`reconciles the bridge stream from the streamed initial subset and applies live changes`, async () => {
    const registry = {
      upsertEntityBridge: vi
        .fn()
        .mockImplementation(async (row: Record<string, unknown>) => row),
      touchEntityBridge: vi.fn().mockResolvedValue(undefined),
      updateEntityBridgeCursor: vi.fn().mockResolvedValue(undefined),
      clearEntityBridgeCursor: vi.fn().mockResolvedValue(undefined),
    }

    const streamClient = {
      baseUrl: `http://streams.test`,
      exists: vi.fn().mockResolvedValue(false),
      create: vi.fn().mockResolvedValue(undefined),
      readJson: vi.fn().mockResolvedValue([
        {
          type: `members`,
          key: `/task/a`,
          value: {
            url: `/task/a`,
            type: `task`,
            status: `idle`,
            tags: { demo: `x` },
            spawn_args: {},
            parent: null,
            type_revision: null,
            inbox_schemas: null,
            state_schemas: null,
            created_at: 1,
            updated_at: 1,
          },
          headers: { operation: `insert` },
        },
        {
          type: `members`,
          key: `/task/b`,
          value: {
            url: `/task/b`,
            type: `task`,
            status: `idle`,
            tags: { demo: `x` },
            spawn_args: {},
            parent: null,
            type_revision: null,
            inbox_schemas: null,
            state_schemas: null,
            created_at: 1,
            updated_at: 1,
          },
          headers: { operation: `insert` },
        },
      ]),
    }

    const manager = new EntityBridgeManager(
      registry as never,
      streamClient as never,
      `http://electric.test`
    )

    const registerPromise = manager.register({ demo: `x` })
    await vi.waitFor(() => {
      expect(mockState.liveCallback).not.toBeNull()
    })

    await mockState.liveCallback?.([
      {
        key: `/task/a`,
        value: {
          url: `/task/a`,
          type: `task`,
          status: `running`,
          tags: { demo: `x` },
          spawn_args: {},
          parent: null,
          type_revision: null,
          inbox_schemas: null,
          state_schemas: null,
          created_at: 1,
          updated_at: 3,
        },
        headers: {
          operation: `insert`,
        },
      },
      {
        key: `/task/c`,
        value: {
          url: `/task/c`,
          type: `task`,
          status: `idle`,
          tags: { demo: `x` },
          spawn_args: {},
          parent: null,
          type_revision: null,
          inbox_schemas: null,
          state_schemas: null,
          created_at: 2,
          updated_at: 2,
        },
        headers: {
          operation: `insert`,
        },
      },
      {
        headers: {
          control: `up-to-date`,
        },
      },
    ])

    const result = await registerPromise

    expect(result).toEqual({
      sourceRef: result.sourceRef,
      streamUrl: `/_entities/${result.sourceRef}`,
    })
    expect(streamClient.create).toHaveBeenCalledWith(
      `/_entities/${result.sourceRef}`,
      {
        contentType: `application/json`,
      }
    )

    expect(
      mockState.producerAppends.every(({ producerId }) => {
        return producerId === `entity-bridge-${result.sourceRef}`
      })
    ).toBe(true)
    expect(mockState.lastConstructedOptions).toMatchObject({
      offset: `-1`,
    })
    expect(registry.updateEntityBridgeCursor).toHaveBeenCalledWith(
      result.sourceRef,
      `live-handle`,
      `9_0`
    )

    const startupEvents = mockState.producerAppends.map(({ payload }) =>
      JSON.parse(payload)
    )
    expect(startupEvents).toEqual([
      expect.objectContaining({
        type: `members`,
        key: `/task/a`,
        value: expect.objectContaining({ status: `running` }),
        headers: expect.objectContaining({ operation: `update` }),
      }),
      expect.objectContaining({
        type: `members`,
        key: `/task/c`,
        value: expect.objectContaining({ url: `/task/c` }),
        headers: expect.objectContaining({ operation: `insert` }),
      }),
      expect.objectContaining({
        type: `members`,
        key: `/task/b`,
        old_value: expect.objectContaining({ url: `/task/b` }),
        headers: expect.objectContaining({ operation: `delete` }),
      }),
    ])

    await mockState.liveCallback?.([
      {
        key: `/task/c`,
        value: {
          url: `/task/c`,
          type: `task`,
          status: `running`,
          tags: { demo: `x` },
          spawn_args: {},
          parent: null,
          type_revision: null,
          inbox_schemas: null,
          state_schemas: null,
          created_at: 2,
          updated_at: 4,
        },
        headers: {
          operation: `update`,
        },
      },
      {
        key: `/task/a`,
        value: {
          url: `/task/a`,
          type: `task`,
          status: `running`,
          tags: { demo: `x` },
          spawn_args: {},
          parent: null,
          type_revision: null,
          inbox_schemas: null,
          state_schemas: null,
          created_at: 1,
          updated_at: 3,
        },
        headers: {
          operation: `delete`,
        },
      },
    ])

    expect(registry.updateEntityBridgeCursor).toHaveBeenLastCalledWith(
      result.sourceRef,
      `live-handle`,
      `9_0`
    )

    const liveEvents = mockState.producerAppends
      .slice(3)
      .map(({ payload }) => JSON.parse(payload))
    expect(liveEvents).toEqual([
      expect.objectContaining({
        key: `/task/c`,
        value: expect.objectContaining({ status: `running` }),
        headers: expect.objectContaining({ operation: `update` }),
      }),
      expect.objectContaining({
        key: `/task/a`,
        old_value: expect.objectContaining({ url: `/task/a` }),
        headers: expect.objectContaining({ operation: `delete` }),
      }),
    ])

    await manager.stop()
    expect(mockState.producerFlushes).toContain(
      `entity-bridge-${result.sourceRef}`
    )
    expect(mockState.producerDetaches).toContain(
      `entity-bridge-${result.sourceRef}`
    )
  })

  it(`reuses a persisted shape cursor when one is available`, async () => {
    const registry = {
      upsertEntityBridge: vi.fn().mockImplementation(async () => ({
        sourceRef: `persisted-ref`,
        tags: { demo: `x` },
        streamUrl: `/_entities/persisted-ref`,
        shapeHandle: `persisted-handle`,
        shapeOffset: `5_0`,
      })),
      touchEntityBridge: vi.fn().mockResolvedValue(undefined),
      updateEntityBridgeCursor: vi.fn().mockResolvedValue(undefined),
      clearEntityBridgeCursor: vi.fn().mockResolvedValue(undefined),
    }

    const streamClient = {
      baseUrl: `http://streams.test`,
      exists: vi.fn().mockResolvedValue(true),
      create: vi.fn().mockResolvedValue(undefined),
      readJson: vi.fn().mockResolvedValue([]),
    }

    const manager = new EntityBridgeManager(
      registry as never,
      streamClient as never,
      `http://electric.test`
    )

    await manager.register({ demo: `x` })

    expect(mockState.lastConstructedOptions).toMatchObject({
      offset: `5_0`,
      handle: `persisted-handle`,
    })
    expect(registry.updateEntityBridgeCursor).not.toHaveBeenCalled()
  })

  it(`restarts from offset=-1 when Electric requests a refetch`, async () => {
    const registry = {
      upsertEntityBridge: vi
        .fn()
        .mockImplementation(async (row: Record<string, unknown>) => row),
      touchEntityBridge: vi.fn().mockResolvedValue(undefined),
      updateEntityBridgeCursor: vi.fn().mockResolvedValue(undefined),
      clearEntityBridgeCursor: vi.fn().mockResolvedValue(undefined),
    }

    const streamClient = {
      baseUrl: `http://streams.test`,
      exists: vi.fn().mockResolvedValue(true),
      create: vi.fn().mockResolvedValue(undefined),
      readJson: vi.fn().mockResolvedValue([]),
    }

    const manager = new EntityBridgeManager(
      registry as never,
      streamClient as never,
      `http://electric.test`
    )

    const registerPromise = manager.register({ demo: `x` })
    await vi.waitFor(() => {
      expect(mockState.liveCallback).not.toBeNull()
    })
    const initialCallback = mockState.liveCallback
    await initialCallback?.([
      {
        key: `/task/a`,
        value: {
          url: `/task/a`,
          type: `task`,
          status: `running`,
          tags: { demo: `x` },
          spawn_args: {},
          parent: null,
          type_revision: null,
          inbox_schemas: null,
          state_schemas: null,
          created_at: 1,
          updated_at: 1,
        },
        headers: {
          operation: `insert`,
        },
      },
      {
        headers: {
          control: `up-to-date`,
        },
      },
    ])
    const result = await registerPromise

    mockState.liveShapeHandle = `refetch-handle`
    mockState.liveLastOffset = `10_0`
    const mustRefetchPromise = initialCallback?.([
      {
        headers: {
          control: `must-refetch`,
        },
      },
    ])
    await vi.waitFor(() => {
      expect(mockState.liveCallbacks).toHaveLength(2)
    })

    expect(registry.clearEntityBridgeCursor).toHaveBeenCalledWith(
      result.sourceRef
    )
    expect(mockState.lastConstructedOptions).toMatchObject({
      offset: `-1`,
    })
    expect(mockState.liveCallbacks).toHaveLength(2)

    const refetchCallback = mockState.liveCallback
    await refetchCallback?.([
      {
        key: `/task/a`,
        value: {
          url: `/task/a`,
          type: `task`,
          status: `idle`,
          tags: { demo: `x` },
          spawn_args: {},
          parent: null,
          type_revision: null,
          inbox_schemas: null,
          state_schemas: null,
          created_at: 1,
          updated_at: 2,
        },
        headers: {
          operation: `insert`,
        },
      },
      {
        headers: {
          control: `up-to-date`,
        },
      },
    ])
    await mustRefetchPromise

    expect(registry.updateEntityBridgeCursor).toHaveBeenLastCalledWith(
      result.sourceRef,
      `refetch-handle`,
      `10_0`
    )
  })

  it(`reuses the existing bridge when the same tag query is registered twice`, async () => {
    const registry = {
      upsertEntityBridge: vi
        .fn()
        .mockImplementation(async (row: Record<string, unknown>) => row),
      touchEntityBridge: vi.fn().mockResolvedValue(undefined),
      updateEntityBridgeCursor: vi.fn().mockResolvedValue(undefined),
      clearEntityBridgeCursor: vi.fn().mockResolvedValue(undefined),
    }

    const streamClient = {
      baseUrl: `http://streams.test`,
      exists: vi.fn().mockResolvedValue(false),
      create: vi.fn().mockResolvedValue(undefined),
      readJson: vi.fn().mockResolvedValue([]),
    }

    const manager = new EntityBridgeManager(
      registry as never,
      streamClient as never,
      `http://electric.test`
    )

    const firstPromise = manager.register({ demo: `x` })
    const secondPromise = manager.register({ demo: `x` })
    await vi.waitFor(() => {
      expect(mockState.liveCallback).not.toBeNull()
    })
    await mockState.liveCallback?.([
      {
        headers: {
          control: `up-to-date`,
        },
      },
    ])
    const first = await firstPromise
    const second = await secondPromise

    expect(second).toEqual(first)
    expect(streamClient.create).toHaveBeenCalledTimes(1)
    expect(mockState.liveCallbacks).toHaveLength(1)
    expect(registry.upsertEntityBridge).toHaveBeenCalledTimes(2)
  })

  it(`uses the manifest source index during idle GC instead of replaying all entity streams`, async () => {
    const registry = {
      listReferencedEntitySourceRefs: vi.fn().mockResolvedValue([`active-ref`]),
      touchEntityBridge: vi.fn().mockResolvedValue(undefined),
      listStaleEntityBridges: vi.fn().mockResolvedValue([
        {
          sourceRef: `active-ref`,
        },
        {
          sourceRef: `stale-ref`,
        },
      ]),
      deleteEntityBridge: vi.fn().mockResolvedValue(undefined),
    }

    const streamClient = {
      readJson: vi.fn(),
    }

    const manager = new EntityBridgeManager(
      registry as never,
      streamClient as never,
      `http://electric.test`
    )

    const staleStop = vi.fn().mockResolvedValue(undefined)
    ;(manager as any).bridges.set(`stale-ref`, {
      stop: staleStop,
    })

    await (manager as any).sweepIdleBridges()

    expect(registry.listReferencedEntitySourceRefs).toHaveBeenCalledOnce()
    expect(registry.touchEntityBridge).toHaveBeenCalledWith(`active-ref`)
    expect(registry.deleteEntityBridge).toHaveBeenCalledWith(`stale-ref`)
    expect(staleStop).toHaveBeenCalledOnce()
    expect(streamClient.readJson).not.toHaveBeenCalled()
  })
})
