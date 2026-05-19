import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EntityProjector } from '../src/entity-projector'

const { mockState } = vi.hoisted(() => ({
  mockState: {
    liveCallback: null as
      | null
      | ((messages: Array<Record<string, unknown>>) => Promise<void> | void),
    constructedOptions: [] as Array<Record<string, unknown>>,
    producerAppends: [] as Array<{
      producerId: string
      payload: string
    }>,
    producerStreams: [] as Array<{ url: string; contentType?: string }>,
  },
}))

vi.mock(`@electric-sql/client`, () => ({
  isControlMessage: (message: { headers?: Record<string, unknown> }) =>
    typeof message.headers?.control === `string`,
  isChangeMessage: (message: { headers?: Record<string, unknown> }) =>
    typeof message.headers?.operation === `string`,
  ShapeStream: class MockShapeStream {
    constructor(options: Record<string, unknown>) {
      mockState.constructedOptions.push(options)
    }

    subscribe(
      callback: (messages: Array<Record<string, unknown>>) => Promise<void>,
      _onError?: (error: Error) => void
    ): () => void {
      mockState.liveCallback = callback
      return () => {
        mockState.liveCallback = null
      }
    }
  },
}))

vi.mock(`@durable-streams/client`, () => ({
  DurableStream: class MockDurableStream {
    constructor(options: { url: string; contentType?: string }) {
      mockState.producerStreams.push(options)
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

    async flush(): Promise<void> {}

    async detach(): Promise<void> {}
  },
}))

function createMockDb(): any {
  return {
    select: () => ({
      from: () => Promise.resolve([]),
    }),
  }
}

function entityRow(
  tenantId: string,
  url: string,
  tags: Record<string, string>,
  status: `idle` | `running` = `idle`
): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    url,
    type: `task`,
    status,
    tags,
    spawn_args: {},
    parent: null,
    type_revision: null,
    inbox_schemas: null,
    state_schemas: null,
    created_at: 1,
    updated_at: status === `running` ? 2 : 1,
  }
}

describe(`EntityProjector`, () => {
  beforeEach(() => {
    mockState.liveCallback = null
    mockState.constructedOptions = []
    mockState.producerAppends = []
    mockState.producerStreams = []
  })

  it(`projects all tenants from one shared entities shape into tenant streams`, async () => {
    const streamClient = {
      baseUrl: `https://streams.test/v1/stream`,
      exists: vi.fn().mockResolvedValue(false),
      create: vi.fn().mockResolvedValue(undefined),
      readJson: vi.fn().mockResolvedValue([]),
    }
    const streamClientForTenant = vi.fn().mockResolvedValue(streamClient)
    const projector = new EntityProjector({
      db: createMockDb(),
      electricUrl: `http://electric.test`,
      streamClientForTenant,
    })
    const registry = {
      upsertEntityBridge: vi
        .fn()
        .mockImplementation(async (row: Record<string, unknown>) => ({
          ...row,
          tenantId: `svc-a`,
        })),
      touchEntityBridge: vi.fn().mockResolvedValue(undefined),
      getEntityBridge: vi.fn(),
      listReferencedEntitySourceRefs: vi.fn().mockResolvedValue([]),
      listStaleEntityBridges: vi.fn().mockResolvedValue([]),
    }

    const startPromise = projector.start()
    await vi.waitFor(() => {
      expect(mockState.liveCallback).not.toBeNull()
    })

    await mockState.liveCallback?.([
      {
        key: `/task/a`,
        value: entityRow(`svc-a`, `/task/a`, { demo: `x` }),
        headers: { operation: `insert` },
      },
      {
        key: `/task/b`,
        value: entityRow(`svc-b`, `/task/b`, { demo: `x` }),
        headers: { operation: `insert` },
      },
      { headers: { control: `up-to-date` } },
    ])
    await startPromise

    const facade = projector.forTenant(`svc-a`, registry as never)
    const result = await facade.register({ demo: `x` })

    expect(mockState.constructedOptions).toHaveLength(1)
    expect(mockState.constructedOptions[0]).toMatchObject({
      params: expect.objectContaining({
        table: `entities`,
        replica: `full`,
      }),
    })
    expect(
      (mockState.constructedOptions[0]!.params as Record<string, unknown>).where
    ).toBeUndefined()
    expect(streamClientForTenant).toHaveBeenCalledWith(`svc-a`)
    expect(streamClient.create).toHaveBeenCalledWith(result.streamUrl, {
      contentType: `application/json`,
    })
    expect(mockState.producerStreams[0]!.url).toBe(
      `https://streams.test/v1/stream${result.streamUrl}`
    )

    expect(mockState.producerAppends).toHaveLength(1)
    expect(JSON.parse(mockState.producerAppends[0]!.payload)).toMatchObject({
      type: `members`,
      key: `/task/a`,
      value: expect.objectContaining({ url: `/task/a` }),
      headers: expect.objectContaining({ operation: `insert` }),
    })

    await mockState.liveCallback?.([
      {
        key: `/task/b`,
        value: entityRow(`svc-b`, `/task/b`, { demo: `x` }, `running`),
        headers: { operation: `update` },
      },
      {
        key: `/task/a`,
        value: entityRow(`svc-a`, `/task/a`, { demo: `x` }, `running`),
        headers: { operation: `update` },
      },
      {
        key: `/task/a`,
        value: entityRow(`svc-a`, `/task/a`, { demo: `x` }, `running`),
        headers: { operation: `delete` },
      },
    ])

    const liveEvents = mockState.producerAppends
      .slice(1)
      .map((append) => JSON.parse(append.payload))
    expect(liveEvents).toEqual([
      expect.objectContaining({
        key: `/task/a`,
        value: expect.objectContaining({ status: `running` }),
        headers: expect.objectContaining({ operation: `update` }),
      }),
      expect.objectContaining({
        key: `/task/a`,
        old_value: expect.objectContaining({ url: `/task/a` }),
        headers: expect.objectContaining({ operation: `delete` }),
      }),
    ])
  })
})
