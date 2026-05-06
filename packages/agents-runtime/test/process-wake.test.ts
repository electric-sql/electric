import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTransaction } from '@durable-streams/state'
import { getCronSourceRef } from '../src/cron-utils'
import { manifestSourceKey } from '../src/manifest-helpers'
import { db } from '../src/observation-sources'
import { processWake } from '../src/process-wake'
import { clearRegistry, defineEntity } from '../src/define-entity'
import { entityStateSchema, passthrough } from '../src/entity-schema'
import { runtimeLog } from '../src/log'
import { ev } from './helpers/event-fixtures'
import { createLocalOnlyTestCollection } from './helpers/local-only'
import type { MockInstance } from 'vitest'
import type { ProcessWakeConfig, WebhookNotification } from '../src/types'
import type { ChangeEvent } from '@durable-streams/state'
import type { ErrorEvent, Manifest } from '../src/entity-schema'

// ---------------------------------------------------------------------------
// Mock @durable-streams/client
// ---------------------------------------------------------------------------

const {
  mockProducerAppend,
  mockProducerFlush,
  mockProducerDetach,
  mockConstructedProducers,
  mockDbClose,
  mockDbPreload,
  mockStreamSubscribeJson,
  mockStreamOffset,
  mockDbOffset,
  mockStreamHead,
  mockStreamJson,
  mockDurableStreamStream,
  mockEntityOnEvent,
  mockEntityOnBatch,
} = vi.hoisted(() => ({
  mockProducerAppend: vi.fn(),
  mockProducerFlush: vi.fn().mockResolvedValue(undefined),
  mockProducerDetach: vi.fn().mockResolvedValue(undefined),
  mockConstructedProducers: [] as Array<{
    producerId: string
    opts?: Record<string, unknown>
  }>,
  mockDbClose: vi.fn(),
  mockDbPreload: vi.fn().mockResolvedValue(undefined),
  mockStreamSubscribeJson: vi.fn().mockReturnValue(() => {}),
  mockStreamOffset: { value: `10_100` },
  mockDbOffset: { value: `10_100` },
  mockStreamHead: vi.fn().mockResolvedValue({
    exists: true,
    offset: `10_100`,
    streamClosed: false,
  }),
  mockStreamJson: vi.fn().mockResolvedValue([]),
  mockDurableStreamStream: vi.fn(),
  mockEntityOnEvent: { current: null as ((event: unknown) => void) | null },
  mockEntityOnBatch: {
    current: null as
      | ((batch: { items: Array<unknown>; offset: string }) => void)
      | null,
  },
}))

const mockStreamResponse = {
  get offset() {
    return mockStreamOffset.value
  },
  json: mockStreamJson,
  subscribeJson: mockStreamSubscribeJson,
}

mockDurableStreamStream.mockResolvedValue(mockStreamResponse)

vi.mock(`@durable-streams/client`, async (importOriginal) => {
  const actual = await importOriginal<any>()
  class MockDurableStream {
    stream = mockDurableStreamStream
    head = mockStreamHead
  }
  class MockIdempotentProducer {
    constructor(
      _stream: unknown,
      producerId: string,
      opts?: Record<string, unknown>
    ) {
      mockConstructedProducers.push({ producerId, opts })
    }

    append = mockProducerAppend
    flush = mockProducerFlush
    detach = mockProducerDetach
  }
  return {
    ...actual,
    DurableStream: MockDurableStream,
    IdempotentProducer: MockIdempotentProducer,
  }
})

// Mock createEntityStreamDB so it doesn't try to create a real TanStack DB
vi.mock(`../src/entity-stream-db`, () => ({
  createEntityStreamDB: vi.fn().mockImplementation(
    (
      _streamUrl: string,
      _state?: unknown,
      _actions?: unknown,
      opts?: {
        onEvent?: (event: unknown) => void
        onBatch?: (batch: { items: Array<unknown>; offset: string }) => void
        writeEvent?: (event: ChangeEvent) => void
        actorFrom?: string
      }
    ) => {
      const manifests = createLocalOnlyTestCollection<Record<string, unknown>>(
        []
      )
      const errors = createLocalOnlyTestCollection<Record<string, unknown>>([])
      const runs = createLocalOnlyTestCollection<Record<string, unknown>>([])
      const texts = createLocalOnlyTestCollection<Record<string, unknown>>([])
      const textDeltas = createLocalOnlyTestCollection<Record<string, unknown>>(
        []
      )
      const toolCalls = createLocalOnlyTestCollection<Record<string, unknown>>(
        []
      )
      const steps = createLocalOnlyTestCollection<Record<string, unknown>>([])
      const inbox = createLocalOnlyTestCollection<Record<string, unknown>>([])
      const wakes = createLocalOnlyTestCollection<Record<string, unknown>>([])
      const childStatus = createLocalOnlyTestCollection<
        Record<string, unknown>
      >([])
      const contextInserted = createLocalOnlyTestCollection<
        Record<string, unknown>
      >([])
      const contextRemoved = createLocalOnlyTestCollection<
        Record<string, unknown>
      >([])
      mockEntityOnEvent.current = opts?.onEvent ?? null
      mockEntityOnBatch.current = opts?.onBatch ?? null
      const applyEventToCollection = (event: {
        type: string
        key: string
        value?: unknown
        headers: { operation: ChangeEvent[`headers`][`operation`] }
      }) => {
        const collection =
          event.type === `manifest`
            ? manifests
            : event.type === `error`
              ? errors
              : undefined
        if (!collection) {
          return
        }

        if (event.headers.operation === `delete`) {
          collection.delete(event.key)
          return
        }

        const row = {
          ...((event.value as Record<string, unknown> | undefined) ?? {}),
          key: event.key,
        }

        if (
          (event.headers.operation === `update` ||
            event.headers.operation === `upsert`) &&
          collection.has(event.key)
        ) {
          collection.update(event.key, (draft) => {
            for (const key of Object.keys(draft)) {
              delete draft[key]
            }
            Object.assign(draft, row)
          })
          return
        }

        collection.insert(row)
      }

      const createWriteTransaction = vi
        .fn()
        .mockImplementation((txOpts?: { autoCommit?: boolean }) => {
          const transaction = createTransaction<Manifest | ErrorEvent>({
            autoCommit: txOpts?.autoCommit ?? true,
            mutationFn: async ({ transaction }) => {
              manifests.utils.acceptMutations(transaction)
              errors.utils.acceptMutations(transaction)

              const txid = `mock-txid`
              const headers: Record<string, string> = opts?.actorFrom
                ? { txid, from: opts.actorFrom }
                : { txid }
              const isManifestValue = (
                value: Manifest | ErrorEvent | {}
              ): value is Manifest =>
                typeof value === `object` &&
                `kind` in value &&
                typeof value.kind === `string`
              const isErrorValue = (
                value: Manifest | ErrorEvent | {}
              ): value is ErrorEvent =>
                typeof value === `object` &&
                `error_code` in value &&
                `message` in value

              for (const mutation of transaction.mutations) {
                const event =
                  mutation.collection.id === manifests.id &&
                  isManifestValue(mutation.modified)
                    ? mutation.type === `insert`
                      ? (entityStateSchema.manifests.insert({
                          key: mutation.key,
                          value: mutation.modified,
                          headers,
                        }) as ChangeEvent)
                      : mutation.type === `update`
                        ? (entityStateSchema.manifests.update({
                            key: mutation.key,
                            value: mutation.modified,
                            ...(isManifestValue(mutation.original)
                              ? { oldValue: mutation.original }
                              : {}),
                            headers,
                          }) as ChangeEvent)
                        : (entityStateSchema.manifests.delete({
                            key: mutation.key,
                            ...(isManifestValue(mutation.original)
                              ? { oldValue: mutation.original }
                              : {}),
                            headers,
                          }) as ChangeEvent)
                    : mutation.collection.id === errors.id &&
                        isErrorValue(mutation.modified)
                      ? (entityStateSchema.errors.insert({
                          key: mutation.key,
                          value: mutation.modified,
                          headers,
                        }) as ChangeEvent)
                      : null

                if (event) {
                  opts?.writeEvent?.(event)
                  applyEventToCollection(event)
                }
              }
            },
          })
          void transaction.isPersisted.promise.catch(() => undefined)
          return transaction
        })

      return {
        collections: {
          runs,
          texts,
          textDeltas,
          toolCalls,
          steps,
          manifests,
          errors,
          inbox,
          wakes,
          childStatus,
          contextInserted,
          contextRemoved,
        },
        close: mockDbClose,
        preload: mockDbPreload,
        get offset() {
          return mockDbOffset.value
        },
        actions: {},
        utils: {
          awaitTxId: vi.fn().mockResolvedValue(undefined),
          awaitWritesSettled: vi.fn().mockResolvedValue(undefined),
          drainPendingWrites: vi.fn().mockResolvedValue(undefined),
          createWriteTransaction,
          applyEvent: vi
            .fn()
            .mockImplementation(
              (event: {
                type: string
                key: string
                value?: unknown
                headers: { operation: ChangeEvent[`headers`][`operation`] }
              }) => {
                applyEventToCollection(event)
                return {
                  isPersisted: { promise: Promise.resolve() },
                  mutations: [],
                  state: `completed`,
                }
              }
            ),
        },
      }
    }
  ),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNotification(
  overrides: Partial<WebhookNotification> = {}
): WebhookNotification {
  return {
    consumerId: `consumer-1`,
    epoch: 1,
    wakeId: `wake-abc`,
    streamPath: `/streams/entity:agent-1`,
    streams: [{ path: `/streams/entity:agent-1`, offset: `0_0` }],
    callback: `http://localhost:3000/_electric/wakes/wake-abc`,
    claimToken: `tok-123`,
    entity: {
      type: `test-agent`,
      status: `active`,
      url: `http://localhost:3000/test-agent/agent-1`,
      streams: {
        main: `/streams/entity:agent-1`,
        error: `/streams/entity-error:agent-1`,
      },
    },
    ...overrides,
  }
}

const BASE_CONFIG: ProcessWakeConfig = {
  baseUrl: `http://localhost:3000`,
  heartbeatInterval: 1_000_000, // effectively disabled in tests
  idleTimeout: 100,
}

const sharedFindingsSchema = {
  findings: {
    schema: passthrough<Record<string, unknown>>(),
    type: `finding`,
    primaryKey: `key`,
  },
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe(`processWake`, () => {
  let fetchMock: MockInstance

  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    clearRegistry()
    mockConstructedProducers.length = 0
    mockDbPreload.mockResolvedValue(undefined)
    mockStreamOffset.value = `10_100`
    mockDbOffset.value = `10_100`
    mockEntityOnEvent.current = null
    mockEntityOnBatch.current = null
    mockStreamHead.mockResolvedValue({
      exists: true,
      offset: `10_100`,
      streamClosed: false,
    })
    fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockImplementation((url, opts) => {
        const urlStr = String(url)
        const method = opts?.method ?? `GET`
        if (method === `PUT` && !urlStr.includes(`subscription=`)) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                url: `/child-worker/spawned-child`,
                streams: { main: `/streams/entity:spawned-child` },
              }),
              { status: 200, headers: { 'content-type': `application/json` } }
            )
          )
        }
        return Promise.resolve(
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': `application/json` },
          })
        )
      })
  })

  afterEach(() => {
    vi.useRealTimers()
    fetchMock.mockRestore()
  })

  it(`returns null without acking for unknown entity types`, async () => {
    // No entity type registered — runtime should silently bail
    const result = await processWake(makeNotification(), BASE_CONFIG)
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it(`returns null without acking when notification has no entity type`, async () => {
    const notification = makeNotification()
    notification.entity!.type = undefined
    const result = await processWake(notification, BASE_CONFIG)
    expect(result).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it(`closes the StreamDB when the wake claim is rejected`, async () => {
    defineEntity(`test-agent`, {
      handler: () => {},
    })

    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: false }), {
        status: 200,
        headers: { 'content-type': `application/json` },
      })
    )

    const result = await processWake(makeNotification(), BASE_CONFIG)

    expect(result).toBeNull()
    expect(mockDbClose).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it(`sends done signal on successful lifecycle`, async () => {
    defineEntity(`test-agent`, {
      handler: () => {},
    })

    await processWake(makeNotification(), BASE_CONFIG)

    // Done signal is the last fetch call to the callback URL with done: true
    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    expect(doneCalls.length).toBeGreaterThanOrEqual(1)
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as Record<
      string,
      unknown
    >
    expect(body.done).toBe(true)
    expect(body.epoch).toBe(1)
  })

  it(`acks the local consumed offset on done even when the stream tail is ahead`, async () => {
    defineEntity(`test-agent`, {
      handler: () => {},
    })

    mockDbOffset.value = `10_100`
    mockProducerFlush.mockImplementation(async () => {
      mockStreamHead.mockResolvedValueOnce({
        exists: true,
        offset: `20_200`,
        streamClosed: false,
      })
    })
    mockDbPreload.mockImplementationOnce(async () => {
      mockEntityOnBatch.current?.({
        items: [],
        offset: `10_100`,
      })
    })

    await processWake(makeNotification(), BASE_CONFIG)

    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as {
      acks: Array<{ path: string; offset: string }>
    }

    expect(body.acks).toEqual([
      { path: `/streams/entity:agent-1`, offset: `10_100` },
    ])
  })

  it(`acks through observed non-fresh batches written during cleanup`, async () => {
    defineEntity(`test-agent`, {
      handler: () => {},
    })

    mockDbOffset.value = `10_100`
    mockProducerFlush.mockImplementationOnce(async () => {
      mockDbOffset.value = `12_000`
      mockStreamHead.mockResolvedValueOnce({
        exists: true,
        offset: `12_000`,
        streamClosed: false,
      })
      mockEntityOnBatch.current?.({
        items: [
          ev(`run`, `run-1`, `update`, {
            status: `completed`,
          }),
        ],
        offset: `12_000`,
      })
    })
    mockDbPreload.mockImplementationOnce(async () => {
      mockEntityOnBatch.current?.({
        items: [],
        offset: `10_100`,
      })
    })

    await processWake(makeNotification(), BASE_CONFIG)

    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as {
      acks: Array<{ path: string; offset: string }>
    }

    expect(body.acks).toEqual([
      { path: `/streams/entity:agent-1`, offset: `12_000` },
    ])
  })

  it(`sends done signal even when handler throws`, async () => {
    defineEntity(`test-agent`, {
      handler: () => {
        throw new Error(`handler exploded`)
      },
    })

    await expect(processWake(makeNotification(), BASE_CONFIG)).rejects.toThrow(
      `handler exploded`
    )

    // Done signal should still have been sent in finally block
    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    expect(doneCalls.length).toBeGreaterThanOrEqual(1)
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as Record<
      string,
      unknown
    >
    expect(body.done).toBe(true)
  })

  it(`skips done callback when shutdown is requested`, async () => {
    const shutdownController = new AbortController()

    defineEntity(`test-agent`, {
      handler: () => {
        shutdownController.abort()
      },
    })

    await expect(
      processWake(makeNotification(), {
        ...BASE_CONFIG,
        shutdownSignal: shutdownController.signal,
      })
    ).resolves.not.toBeNull()

    const doneCalls = fetchMock.mock.calls.filter(
      ([url, opts]) =>
        String(url).includes(`/_electric/wakes/wake-abc`) &&
        (opts?.body as string | undefined)?.includes(`"done":true`)
    )

    expect(doneCalls).toHaveLength(0)
  })

  it(`surfaces both the primary wake error and done callback failure`, async () => {
    defineEntity(`test-agent`, {
      handler: () => {
        throw new Error(`handler exploded`)
      },
    })

    fetchMock.mockImplementation((url, opts) => {
      const urlStr = String(url)
      if (
        urlStr.includes(`/_electric/wakes/wake-abc`) &&
        (opts?.body as string | undefined)?.includes(`"done":true`)
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: { code: `INVALID_OFFSET`, message: `bad ack` },
            }),
            {
              status: 409,
              headers: { 'content-type': `application/json` },
            }
          )
        )
      }

      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': `application/json` },
        })
      )
    })

    await expect(
      processWake(makeNotification(), BASE_CONFIG)
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).message).toContain(`handler exploded`)
      return true
    })
  })

  it(`completes without error for a simple handler`, async () => {
    defineEntity(`test-agent`, {
      handler: () => {},
    })

    const result = await processWake(makeNotification(), BASE_CONFIG)

    expect(result).not.toBeNull()
  })

  it(`executes manifest spawn entries via server API`, async () => {
    defineEntity(`test-agent`, {
      handler: async (ctx) => {
        await ctx.spawn(`child-worker`, `worker-1`, { task: `process` })
      },
    })

    await processWake(makeNotification(), BASE_CONFIG)

    const spawnCalls = fetchMock.mock.calls.filter(
      ([url, opts]) =>
        (opts as RequestInit | undefined)?.method === `PUT` &&
        String(url).includes(`/child-worker/`)
    )
    expect(spawnCalls.length).toBe(1)
    const [spawnUrl, spawnOpts] = spawnCalls[0]!
    expect(String(spawnUrl)).toContain(`/child-worker/worker-1`)
    expect((spawnOpts as RequestInit | undefined)?.method).toBe(`PUT`)
    const body = JSON.parse(spawnOpts!.body as string) as Record<
      string,
      unknown
    >
    expect(body.parent).toBe(`http://localhost:3000/test-agent/agent-1`)
    expect((body.args as Record<string, unknown>).task).toBe(`process`)
  })

  it(`executes send via server API`, async () => {
    defineEntity(`test-agent`, {
      handler: (ctx) => {
        ctx.send(`target-entity-2`, { action: `ping` })
      },
    })

    await processWake(makeNotification(), BASE_CONFIG)

    const sendCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/send`)
    )
    expect(sendCalls.length).toBe(1)
    const [sendUrl, sendOpts] = sendCalls[0]!
    expect(String(sendUrl)).toContain(`target-entity-2/send`)
    const body = JSON.parse(sendOpts!.body as string) as Record<string, unknown>
    expect(body.from).toBe(`http://localhost:3000/test-agent/agent-1`)
    expect((body.payload as Record<string, unknown>).action).toBe(`ping`)
  })

  it(`passes afterMs through to server send API`, async () => {
    defineEntity(`test-agent`, {
      handler: (ctx) => {
        ctx.send(`target-entity-2`, { action: `later` }, { afterMs: 30_000 })
      },
    })

    await processWake(makeNotification(), BASE_CONFIG)

    const sendCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/send`)
    )
    expect(sendCalls.length).toBe(1)
    const body = JSON.parse(sendCalls[0]![1]!.body as string) as Record<
      string,
      unknown
    >
    expect(body.afterMs).toBe(30_000)
    expect((body.payload as Record<string, unknown>).action).toBe(`later`)
  })

  it(`cron observe registers wake and cron source with server`, async () => {
    const { cron } = await import(`../src/observation-sources`)

    defineEntity(`test-agent`, {
      async handler(ctx) {
        await ctx.observe(cron(`*/5 * * * *`))
      },
    })

    await processWake(makeNotification(), BASE_CONFIG)

    // Should have registered the cron source
    const cronCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/cron/register`)
    )
    expect(cronCalls.length).toBe(1)
    const cronBody = JSON.parse(cronCalls[0]![1]!.body as string) as Record<
      string,
      unknown
    >
    expect(cronBody.expression).toBe(`*/5 * * * *`)
    expect(cronBody.timezone).toBe(`UTC`)

    // Verify a POST to /_electric/wake was made (wake registration)
    const wakePostCalls = fetchMock.mock.calls.filter(
      ([url, opts]) =>
        String(url).includes(`/_electric/wake`) &&
        !String(url).includes(`wake-abc`) &&
        !String(url).includes(`/cron/`) &&
        (opts as RequestInit | undefined)?.method === `POST`
    )
    expect(wakePostCalls.length).toBe(1)
    const wakeBody = JSON.parse(wakePostCalls[0]![1]!.body as string) as Record<
      string,
      unknown
    >
    expect(wakeBody.subscriberUrl).toBe(
      `http://localhost:3000/test-agent/agent-1`
    )
    expect(wakeBody.sourceUrl).toContain(`/_cron/`)
    expect(wakeBody.manifestKey).toBe(
      manifestSourceKey(`cron`, getCronSourceRef(`*/5 * * * *`, `UTC`))
    )
  })

  it(`ignores 409 on idempotent spawn`, async () => {
    defineEntity(`test-agent`, {
      handler: async (ctx) => {
        await ctx.spawn(`child-worker`, `worker-duplicate`, {})
      },
    })

    // Make spawn return 409
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === `PUT` && String(url).includes(`/child-worker/`)) {
        return Promise.resolve(new Response(`already exists`, { status: 409 }))
      }
      if (
        opts?.method === `GET` &&
        String(url).includes(`/child-worker/worker-duplicate`)
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              url: `/child-worker/worker-duplicate`,
              type: `child-worker`,
              streams: { main: `/child-worker/worker-duplicate/main` },
            }),
            {
              status: 200,
              headers: { 'content-type': `application/json` },
            }
          )
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': `application/json` },
        })
      )
    })

    // Should not throw
    await expect(
      processWake(makeNotification(), BASE_CONFIG)
    ).resolves.not.toThrow()
  })

  it(`fails the wake immediately on spawn failure`, async () => {
    defineEntity(`test-agent`, {
      handler: async (ctx) => {
        await ctx.spawn(`child-worker`, `worker-fail`, {})
      },
    })

    // Make spawn return 500
    fetchMock.mockImplementation((url: string, opts?: RequestInit) => {
      if (opts?.method === `PUT` && String(url).includes(`/child-worker/`)) {
        return Promise.resolve(
          new Response(`internal server error`, { status: 500 })
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': `application/json` },
        })
      )
    })

    await expect(processWake(makeNotification(), BASE_CONFIG)).rejects.toThrow(
      /worker-fail/
    )
  })

  it(`fails the wake when a background send fails`, async () => {
    defineEntity(`test-agent`, {
      handler: (ctx) => {
        ctx.send(`target-entity-2`, { action: `ping` })
      },
    })

    fetchMock.mockImplementation((url, opts) => {
      const urlStr = String(url)
      if (urlStr.includes(`target-entity-2/send`)) {
        return Promise.resolve(new Response(`send failed`, { status: 500 }))
      }
      const method = opts?.method ?? `GET`
      if (method === `PUT` && !urlStr.includes(`subscription=`)) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              url: `/child-worker/spawned-child`,
              streams: { main: `/streams/entity:spawned-child` },
            }),
            { status: 200, headers: { 'content-type': `application/json` } }
          )
        )
      }
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': `application/json` },
        })
      )
    })

    await expect(processWake(makeNotification(), BASE_CONFIG)).rejects.toThrow(
      /send to target-entity-2 failed/
    )
  })

  it(`heartbeat is registered with configured interval`, async () => {
    const setIntervalSpy = vi.spyOn(globalThis, `setInterval`)

    defineEntity(`test-agent`, {
      handler: () => {},
    })

    await processWake(makeNotification(), {
      ...BASE_CONFIG,
      heartbeatInterval: 7_500,
    })

    // setInterval should have been called with the configured interval
    const heartbeatCall = setIntervalSpy.mock.calls.find(
      ([, delay]) => delay === 7_500
    )
    expect(heartbeatCall).toBeDefined()

    setIntervalSpy.mockRestore()
  })

  it(`flushes producer on completion`, async () => {
    defineEntity(`test-agent`, {
      handler: () => {},
    })

    await processWake(makeNotification(), BASE_CONFIG)

    expect(mockProducerFlush).toHaveBeenCalled()
    expect(mockProducerDetach).toHaveBeenCalledOnce()
  })

  it(`creates the main entity producer with autoClaim enabled`, async () => {
    defineEntity(`test-agent`, {
      handler: () => {},
    })

    await processWake(makeNotification(), BASE_CONFIG)

    expect(mockConstructedProducers).toContainEqual({
      producerId: `entity-http://localhost:3000/test-agent/agent-1`,
      opts: expect.objectContaining({
        epoch: 1,
        autoClaim: true,
      }),
    })
  })

  it(`creates shared-state producers with autoClaim enabled`, async () => {
    defineEntity(`test-agent`, {
      handler: async (ctx) => {
        ctx.mkdb(`board-1`, sharedFindingsSchema)
        await ctx.observe(db(`board-1`, sharedFindingsSchema))
      },
    })

    await processWake(makeNotification(), BASE_CONFIG)

    expect(mockConstructedProducers).toContainEqual({
      producerId: `shared-state-http://localhost:3000/test-agent/agent-1-board-1`,
      opts: expect.objectContaining({
        epoch: 1,
        autoClaim: true,
      }),
    })
  })

  it(`returns persisted manifest rows when manifest is non-empty`, async () => {
    defineEntity(`test-agent`, {
      handler: async (ctx) => {
        await ctx.spawn(`child-worker`, `worker-1`, {})
      },
    })

    const result = await processWake(makeNotification(), BASE_CONFIG)

    expect(result?.manifest).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: `child`,
          id: `worker-1`,
          entity_type: `child-worker`,
          entity_url: `/child-worker/spawned-child`,
          observed: true,
        }),
      ])
    )
  })

  it(`closes the StreamDB when preflight stream loading fails`, async () => {
    defineEntity(`test-agent`, {
      handler: () => {},
    })

    mockDbPreload.mockRejectedValueOnce(new Error(`stream exploded`))

    await expect(processWake(makeNotification(), BASE_CONFIG)).rejects.toThrow(
      `stream exploded`
    )

    expect(mockDbClose).toHaveBeenCalledOnce()
  })

  it(`continues in-process when a new message arrives after the first handler pass`, async () => {
    const wakeTypes: Array<string> = []
    let firstPassSeenResolve: (() => void) | null = null
    const firstPassSeen = new Promise<void>((resolve) => {
      firstPassSeenResolve = resolve
    })

    defineEntity(`test-agent`, {
      handler: (_ctx, wake) => {
        wakeTypes.push(wake.type)
        if (wakeTypes.length === 1) {
          firstPassSeenResolve?.()
        }
      },
    })

    const wakePromise = processWake(
      makeNotification({ triggerEvent: `message_received` }),
      {
        ...BASE_CONFIG,
        idleTimeout: 50,
      }
    )

    await firstPassSeen
    await new Promise((resolve) => setTimeout(resolve, 5))

    mockEntityOnBatch.current?.({
      items: [
        ev(`message_received`, `m-1`, `insert`, { payload: `follow-up` }),
      ],
      offset: `11_000`,
    })

    await wakePromise

    expect(wakeTypes).toEqual([`message_received`, `message_received`])

    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as {
      acks: Array<{ path: string; offset: string }>
    }
    expect(body.acks).toEqual([
      { path: `/streams/entity:agent-1`, offset: `11_000` },
    ])
  })

  it(`processes a fresh message that arrives during idle after a management-only catch-up wake`, async () => {
    const wakePayloads: Array<unknown> = []

    defineEntity(`test-agent`, {
      handler: (_ctx, wake) => {
        wakePayloads.push(wake.payload)
      },
    })

    mockDbPreload.mockImplementationOnce(async () => {
      mockEntityOnBatch.current?.({
        items: [
          ev(`entity_created`, `created-1`, `insert`, {}, { offset: `0_0` }),
        ],
        offset: `0_0`,
      })
    })

    setTimeout(() => {
      mockEntityOnBatch.current?.({
        items: [
          ev(
            `message_received`,
            `m-1`,
            `insert`,
            { payload: `hello` },
            { offset: `1_0` }
          ),
        ],
        offset: `1_0`,
      })
    }, 0)

    await processWake(
      makeNotification({ triggerEvent: `message_received` }),
      BASE_CONFIG
    )

    expect(wakePayloads).toEqual([`hello`])

    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as {
      acks: Array<{ path: string; offset: string }>
    }
    expect(body.acks).toEqual([
      { path: `/streams/entity:agent-1`, offset: `1_0` },
    ])
  })

  it(`adopts a wake event that arrives during the initial wait window`, async () => {
    const wakeTypes: Array<string> = []

    defineEntity(`test-agent`, {
      handler: (_ctx, wake) => {
        wakeTypes.push(wake.type)
      },
    })

    setTimeout(() => {
      mockEntityOnBatch.current?.({
        items: [
          ev(
            `wake`,
            `wake-1`,
            `insert`,
            { source: `/child/1`, changes: [] },
            { offset: `1_0` }
          ),
        ],
        offset: `1_0`,
      })
    }, 50)

    await processWake(makeNotification({ triggerEvent: `message_received` }), {
      ...BASE_CONFIG,
      idleTimeout: 300,
    })

    expect(wakeTypes).toEqual([`wake`])

    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as {
      acks: Array<{ path: string; offset: string }>
    }
    expect(body.acks).toEqual([
      { path: `/streams/entity:agent-1`, offset: `1_0` },
    ])
  })

  it(`runs the handler immediately when catch-up already includes an inbox message`, async () => {
    const wakePayloads: Array<unknown> = []

    defineEntity(`test-agent`, {
      handler: (_ctx, wake) => {
        wakePayloads.push(wake.payload)
      },
    })

    mockDbPreload.mockImplementationOnce(async () => {
      mockEntityOnBatch.current?.({
        items: [
          ev(`entity_created`, `created-1`, `insert`, {}, { offset: `0_0` }),
          ev(
            `message_received`,
            `m-1`,
            `insert`,
            { payload: `hello` },
            { offset: `1_0` }
          ),
        ],
        offset: `1_0`,
      })
    })

    await processWake(
      makeNotification({ triggerEvent: `message_received` }),
      BASE_CONFIG
    )

    expect(wakePayloads).toEqual([`hello`])

    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as {
      acks: Array<{ path: string; offset: string }>
    }
    expect(body.acks).toEqual([
      { path: `/streams/entity:agent-1`, offset: `1_0` },
    ])
  })

  it(`runs the handler immediately when notification offset is the prior ack and catch-up has the new message`, async () => {
    const wakePayloads: Array<unknown> = []
    const warnMessages: Array<string> = []
    const warnMock = vi
      .spyOn(runtimeLog, `warn`)
      .mockImplementation((_prefix: string, message: string) => {
        warnMessages.push(message)
      })

    defineEntity(`test-agent`, {
      handler: (_ctx, wake) => {
        wakePayloads.push(wake.payload)
      },
    })

    mockDbOffset.value = `10_100`
    mockStreamOffset.value = `11_0`
    mockDbPreload.mockImplementationOnce(async () => {
      mockEntityOnBatch.current?.({
        items: [
          ev(`entity_created`, `created-1`, `insert`, {}, { offset: `10_100` }),
          ev(
            `message_received`,
            `m-1`,
            `insert`,
            { payload: `hello` },
            { offset: `11_0` }
          ),
        ],
        offset: `11_0`,
      })
    })

    await processWake(
      makeNotification({
        triggerEvent: `message_received`,
        streams: [{ path: `/streams/entity:agent-1`, offset: `10_100` }],
      }),
      BASE_CONFIG
    )

    expect(wakePayloads).toEqual([`hello`])

    const timedOutWarnings = warnMessages.filter((m) =>
      m.includes(`timed out waiting 100ms for concrete wake input`)
    )
    expect(timedOutWarnings).toEqual([])

    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as {
      acks: Array<{ path: string; offset: string }>
    }
    expect(body.acks).toEqual([
      { path: `/streams/entity:agent-1`, offset: `11_0` },
    ])

    warnMock.mockRestore()
  })

  it(`runs the handler with the new message when it arrives on live SSE during the 100ms wait`, async () => {
    const wakePayloads: Array<unknown> = []

    defineEntity(`test-agent`, {
      handler: (_ctx, wake) => {
        wakePayloads.push(wake.payload)
      },
    })

    mockDbOffset.value = `10_100`
    mockStreamOffset.value = `10_100`
    // Catch-up is empty — no events at offsets >= the prior ack at notification time.
    // (Historical events are below the notification offset; nothing fresh has propagated yet.)
    mockDbPreload.mockImplementationOnce(async () => {
      mockEntityOnBatch.current?.({
        items: [],
        offset: `10_100`,
      })
    })

    // The actual fresh message arrives via live SSE during the 100ms wait window
    // in waitForCurrentWakeInput (acceptLiveInputs is still false at this point).
    setTimeout(() => {
      mockEntityOnBatch.current?.({
        items: [
          ev(
            `message_received`,
            `m-1`,
            `insert`,
            { payload: `hello` },
            { offset: `11_0` }
          ),
        ],
        offset: `11_0`,
      })
    }, 5)

    await processWake(
      makeNotification({
        triggerEvent: `message_received`,
        streams: [{ path: `/streams/entity:agent-1`, offset: `10_100` }],
      }),
      BASE_CONFIG
    )

    // Bug: handler fires once with undefined payload (stale snapshot), then again
    // with the real payload from the queued pending wake. Should fire exactly once
    // with the real payload.
    expect(wakePayloads).toEqual([`hello`])

    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as {
      acks: Array<{ path: string; offset: string }>
    }
    expect(body.acks).toEqual([
      { path: `/streams/entity:agent-1`, offset: `11_0` },
    ])
  })

  it(`skips a spawn-only wake when catch-up contains only management events`, async () => {
    const handler = vi.fn()

    defineEntity(`test-agent`, {
      handler,
    })

    mockDbOffset.value = `0_0`
    mockStreamOffset.value = `0_0`
    mockDbPreload.mockImplementationOnce(async () => {
      mockEntityOnBatch.current?.({
        items: [
          ev(`entity_created`, `created-1`, `insert`, {}, { offset: `0_0` }),
        ],
        offset: `0_0`,
      })
    })

    await processWake(
      makeNotification({ triggerEvent: `message_received` }),
      BASE_CONFIG
    )

    expect(handler).not.toHaveBeenCalled()

    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as {
      acks: Array<{ path: string; offset: string }>
    }
    expect(body.acks).toEqual([
      { path: `/streams/entity:agent-1`, offset: `0_0` },
    ])
  })

  it(`skips copied fork history when catch-up ends with fork reconciliation`, async () => {
    const handler = vi.fn()

    defineEntity(`test-agent`, {
      handler,
    })

    mockDbOffset.value = `20_0`
    mockStreamOffset.value = `20_0`
    mockDbPreload.mockImplementationOnce(async () => {
      mockEntityOnBatch.current?.({
        items: [
          ev(
            `message_received`,
            `m-old`,
            `insert`,
            { payload: `historical prompt` },
            { offset: `1_0` }
          ),
          ev(`run`, `run-old`, `update`, {
            status: `completed`,
          }),
          ev(
            `entity_created`,
            `entity-created`,
            `insert`,
            {},
            { offset: `20_0`, forkedFrom: `/test-agent/source` }
          ),
        ],
        offset: `20_0`,
      })
    })

    await processWake(
      makeNotification({
        triggerEvent: `message_received`,
        streams: [{ path: `/streams/entity:agent-1`, offset: `0_0` }],
      }),
      { ...BASE_CONFIG, idleTimeout: 1 }
    )

    expect(handler).not.toHaveBeenCalled()

    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as {
      acks: Array<{ path: string; offset: string }>
    }
    expect(body.acks).toEqual([
      { path: `/streams/entity:agent-1`, offset: `20_0` },
    ])
  })

  it(`collapses consecutive pending wake batches into one handler pass using the newest wake`, async () => {
    const wakeSummaries: Array<string> = []
    let firstPassSeenResolve: (() => void) | null = null
    const firstPassSeen = new Promise<void>((resolve) => {
      firstPassSeenResolve = resolve
    })
    let releaseFirstPass = (): void => {
      throw new Error(`expected first-pass release`)
    }
    const blockFirstPass = new Promise<void>((resolve) => {
      releaseFirstPass = resolve
    })

    defineEntity(`test-agent`, {
      handler: async (_ctx, wake) => {
        wakeSummaries.push(
          wake.type === `wake`
            ? `wake:${wake.source}`
            : `message:${String(wake.payload ?? ``)}`
        )

        if (wakeSummaries.length === 1) {
          firstPassSeenResolve?.()
          await blockFirstPass
        }
      },
    })

    const wakePromise = processWake(
      makeNotification({ triggerEvent: `message_received` }),
      BASE_CONFIG
    )

    await firstPassSeen

    mockEntityOnBatch.current?.({
      items: [
        ev(`wake`, `wake-1`, `insert`, {
          source: `/child/first`,
        }),
      ],
      offset: `11_000`,
    })
    mockEntityOnBatch.current?.({
      items: [
        ev(`wake`, `wake-2`, `insert`, {
          source: `/child/second`,
        }),
      ],
      offset: `12_000`,
    })

    releaseFirstPass()
    await wakePromise

    expect(wakeSummaries).toEqual([`message:`, `wake:/child/second`])

    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as {
      acks: Array<{ path: string; offset: string }>
    }
    expect(body.acks).toEqual([
      { path: `/streams/entity:agent-1`, offset: `12_000` },
    ])
  })

  it(`passes the full pending delta to the resumed handler pass`, async () => {
    const secondPassEvents: Array<string> = []
    let firstPassSeenResolve: (() => void) | null = null
    const firstPassSeen = new Promise<void>((resolve) => {
      firstPassSeenResolve = resolve
    })
    let releaseFirstPass = (): void => {
      throw new Error(`expected first-pass release`)
    }
    const blockFirstPass = new Promise<void>((resolve) => {
      releaseFirstPass = resolve
    })

    defineEntity(`test-agent`, {
      handler: async (ctx, wake) => {
        if (wake.type === `message_received`) {
          firstPassSeenResolve?.()
          await blockFirstPass
          return
        }

        secondPassEvents.push(
          ...ctx.events.map((event) => {
            if (event.type === `wake`) {
              return `wake:${String((event.value as { source?: string }).source ?? ``)}`
            }
            if (event.type === `message_received`) {
              return `message:${String((event.value as { payload?: unknown }).payload ?? ``)}`
            }
            return event.type
          })
        )
      },
    })

    const wakePromise = processWake(
      makeNotification({ triggerEvent: `message_received` }),
      BASE_CONFIG
    )

    await firstPassSeen

    mockEntityOnBatch.current?.({
      items: [
        ev(`wake`, `wake-1`, `insert`, {
          source: `/child/first`,
        }),
      ],
      offset: `11_000`,
    })
    mockEntityOnBatch.current?.({
      items: [
        ev(`run`, `run-1`, `update`, {
          status: `completed`,
        }),
      ],
      offset: `11_500`,
    })
    mockEntityOnBatch.current?.({
      items: [
        ev(`wake`, `wake-2`, `insert`, {
          source: `/child/second`,
        }),
      ],
      offset: `12_000`,
    })

    releaseFirstPass()
    await wakePromise

    expect(secondPassEvents).toEqual([
      `wake:/child/first`,
      `run`,
      `wake:/child/second`,
    ])
  })

  it(`collapses wake batches only until a later message batch and then handles the message next`, async () => {
    const wakeSummaries: Array<string> = []
    let firstPassSeenResolve: (() => void) | null = null
    const firstPassSeen = new Promise<void>((resolve) => {
      firstPassSeenResolve = resolve
    })
    let releaseFirstPass = (): void => {
      throw new Error(`expected first-pass release`)
    }
    const blockFirstPass = new Promise<void>((resolve) => {
      releaseFirstPass = resolve
    })

    defineEntity(`test-agent`, {
      handler: async (_ctx, wake) => {
        wakeSummaries.push(
          wake.type === `wake`
            ? `wake:${wake.source}`
            : `message:${String(wake.payload ?? ``)}`
        )

        if (wakeSummaries.length === 1) {
          firstPassSeenResolve?.()
          await blockFirstPass
        }
      },
    })

    const wakePromise = processWake(
      makeNotification({ triggerEvent: `message_received` }),
      BASE_CONFIG
    )

    await firstPassSeen

    mockEntityOnBatch.current?.({
      items: [
        ev(`wake`, `wake-1`, `insert`, {
          source: `/child/first`,
        }),
      ],
      offset: `11_000`,
    })
    mockEntityOnBatch.current?.({
      items: [
        ev(`run`, `run-1`, `update`, {
          status: `completed`,
        }),
      ],
      offset: `11_500`,
    })
    mockEntityOnBatch.current?.({
      items: [
        ev(`wake`, `wake-2`, `insert`, {
          source: `/child/second`,
        }),
      ],
      offset: `12_000`,
    })
    mockEntityOnBatch.current?.({
      items: [
        ev(`message_received`, `m-1`, `insert`, {
          payload: `follow-up`,
        }),
      ],
      offset: `13_000`,
    })

    releaseFirstPass()
    await wakePromise

    expect(wakeSummaries).toEqual([
      `message:`,
      `wake:/child/second`,
      `message:follow-up`,
    ])

    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as {
      acks: Array<{ path: string; offset: string }>
    }
    expect(body.acks).toEqual([
      { path: `/streams/entity:agent-1`, offset: `13_000` },
    ])
  })

  it(`prefers a message when the same pending batch also includes a later wake`, async () => {
    const wakeSummaries: Array<string> = []
    let firstPassSeenResolve: (() => void) | null = null
    const firstPassSeen = new Promise<void>((resolve) => {
      firstPassSeenResolve = resolve
    })
    let releaseFirstPass = (): void => {
      throw new Error(`expected first-pass release`)
    }
    const blockFirstPass = new Promise<void>((resolve) => {
      releaseFirstPass = resolve
    })

    defineEntity(`test-agent`, {
      handler: async (_ctx, wake) => {
        wakeSummaries.push(
          wake.type === `wake`
            ? `wake:${wake.source}`
            : `message:${String(wake.payload ?? ``)}`
        )

        if (wakeSummaries.length === 1) {
          firstPassSeenResolve?.()
          await blockFirstPass
        }
      },
    })

    const wakePromise = processWake(
      makeNotification({ triggerEvent: `message_received` }),
      BASE_CONFIG
    )

    await firstPassSeen

    mockEntityOnBatch.current?.({
      items: [
        ev(`message_received`, `m-1`, `insert`, {
          payload: `follow-up`,
        }),
        ev(`wake`, `wake-1`, `insert`, {
          source: `/child/late`,
        }),
      ],
      offset: `12_000`,
    })

    releaseFirstPass()
    await wakePromise

    expect(wakeSummaries).toEqual([`message:`, `message:follow-up`])

    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as {
      acks: Array<{ path: string; offset: string }>
    }
    expect(body.acks).toEqual([
      { path: `/streams/entity:agent-1`, offset: `12_000` },
    ])
  })

  it(`prefers a message when the same pending batch starts with a wake and later includes a message`, async () => {
    const wakeSummaries: Array<string> = []
    let firstPassSeenResolve: (() => void) | null = null
    const firstPassSeen = new Promise<void>((resolve) => {
      firstPassSeenResolve = resolve
    })
    let releaseFirstPass = (): void => {
      throw new Error(`expected first-pass release`)
    }
    const blockFirstPass = new Promise<void>((resolve) => {
      releaseFirstPass = resolve
    })

    defineEntity(`test-agent`, {
      handler: async (_ctx, wake) => {
        wakeSummaries.push(
          wake.type === `wake`
            ? `wake:${wake.source}`
            : `message:${String(wake.payload ?? ``)}`
        )

        if (wakeSummaries.length === 1) {
          firstPassSeenResolve?.()
          await blockFirstPass
        }
      },
    })

    const wakePromise = processWake(
      makeNotification({ triggerEvent: `message_received` }),
      BASE_CONFIG
    )

    await firstPassSeen

    mockEntityOnBatch.current?.({
      items: [
        ev(`wake`, `wake-1`, `insert`, {
          source: `/child/first`,
        }),
        ev(`message_received`, `m-1`, `insert`, {
          payload: `follow-up`,
        }),
        ev(`wake`, `wake-2`, `insert`, {
          source: `/child/late`,
        }),
      ],
      offset: `12_000`,
    })

    releaseFirstPass()
    await wakePromise

    expect(wakeSummaries).toEqual([`message:`, `message:follow-up`])

    const doneCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes(`/_electric/wakes/wake-abc`)
    )
    const lastDoneCall = doneCalls[doneCalls.length - 1]!
    const body = JSON.parse(lastDoneCall[1]!.body as string) as {
      acks: Array<{ path: string; offset: string }>
    }
    expect(body.acks).toEqual([
      { path: `/streams/entity:agent-1`, offset: `12_000` },
    ])
  })

  it(`prefers the newest actionable catch-up event when reconstructing the wake event`, async () => {
    const wakeTypes: Array<string> = []

    defineEntity(`test-agent`, {
      handler: (_ctx, wake) => {
        wakeTypes.push(wake.type)
      },
    })

    mockDbPreload.mockImplementationOnce(async () => {
      mockEntityOnBatch.current?.({
        items: [
          ev(`wake`, `wake-1`, `insert`, {
            source: `/child/c1`,
            timeout: false,
            changes: [],
          }),
          ev(`message_received`, `m-1`, `insert`, { payload: `newest` }),
        ],
        offset: `10_100`,
      })
    })

    await processWake(makeNotification(), {
      ...BASE_CONFIG,
      idleTimeout: 0,
    })

    expect(wakeTypes).toEqual([`message_received`])
  })

  it(`does not send offset -1 in done ack when notification offset is -1 and stream is empty`, async () => {
    defineEntity(`test-agent`, {
      handler: () => {},
    })

    mockDbOffset.value = `-1`
    mockStreamOffset.value = `-1`

    await processWake(
      makeNotification({
        streams: [{ path: `/streams/entity:agent-1`, offset: `-1` }],
      }),
      BASE_CONFIG
    )

    const doneCalls = fetchMock.mock.calls.filter(
      ([url, opts]) =>
        String(url).includes(`/_electric/wakes/wake-abc`) &&
        (opts?.body as string | undefined)?.includes(`"done":true`)
    )
    expect(doneCalls.length).toBe(1)
    const body = JSON.parse(doneCalls[0]![1]!.body as string) as {
      acks: Array<{ path: string; offset: string }>
    }

    for (const ack of body.acks) {
      expect(ack.offset).not.toBe(`-1`)
    }
  })
})
