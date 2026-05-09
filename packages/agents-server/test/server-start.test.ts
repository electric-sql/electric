import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ElectricAgentsServer } from '../src/server'
import { TEST_POSTGRES_URL } from './test-backend'

const {
  mockAgentHandlerMock,
  mockAgentRegisterTypesMock,
  mockAgentAbortWakesMock,
  mockAgentDrainWakesMock,
  createEntityRegistryMock,
  createRuntimeHandlerMock,
  schedulerCancelManifestDelayedSendMock,
  schedulerEnqueueCronTickMock,
  schedulerSyncManifestDelayedSendMock,
  schedulerStartMock,
  schedulerStopMock,
  registryBeginDispatchWakeMock,
  registryCloseMock,
  registryExpireStaleActiveClaimsMock,
  registryGetEntityMock,
  registryGetEntityByStreamMock,
  registryGetEntityTypeMock,
  registryGetRunnerMock,
  registryInitializeMock,
  registryListEntitiesMock,
  registryMarkWakeDeliveredMock,
  registryMarkWakeFailedMock,
  registryExpireStaleOutstandingWakesMock,
  registryUpsertConsumerCallbackMock,
  runMigrationsMock,
  selectFromMock,
  selectMock,
  serverAddressMock,
  serverCloseMock,
  serverListenMock,
  serverOnMock,
  streamAppendMock,
  streamCreateMock,
  streamExistsMock,
  streamMintWakeNotificationMock,
  streamReadJsonMock,
} = vi.hoisted(() => ({
  mockAgentHandlerMock: vi.fn(),
  mockAgentRegisterTypesMock: vi.fn(),
  mockAgentAbortWakesMock: vi.fn(),
  mockAgentDrainWakesMock: vi.fn(),
  createEntityRegistryMock: vi.fn(),
  createRuntimeHandlerMock: vi.fn(),
  schedulerCancelManifestDelayedSendMock: vi.fn(),
  schedulerEnqueueCronTickMock: vi.fn(),
  schedulerSyncManifestDelayedSendMock: vi.fn(),
  schedulerStartMock: vi.fn(),
  schedulerStopMock: vi.fn(),
  registryBeginDispatchWakeMock: vi.fn(),
  registryCloseMock: vi.fn(),
  registryExpireStaleActiveClaimsMock: vi.fn(),
  registryGetEntityMock: vi.fn(),
  registryGetEntityByStreamMock: vi.fn(),
  registryGetEntityTypeMock: vi.fn(),
  registryGetRunnerMock: vi.fn(),
  registryInitializeMock: vi.fn(),
  registryListEntitiesMock: vi.fn(),
  registryMarkWakeDeliveredMock: vi.fn(),
  registryMarkWakeFailedMock: vi.fn(),
  registryExpireStaleOutstandingWakesMock: vi.fn(),
  registryUpsertConsumerCallbackMock: vi.fn(),
  runMigrationsMock: vi.fn(),
  selectFromMock: vi.fn(),
  selectMock: vi.fn(),
  serverAddressMock: vi.fn(),
  serverCloseMock: vi.fn(),
  serverListenMock: vi.fn(),
  serverOnMock: vi.fn(),
  streamAppendMock: vi.fn(),
  streamCreateMock: vi.fn(),
  streamExistsMock: vi.fn(),
  streamMintWakeNotificationMock: vi.fn(),
  streamReadJsonMock: vi.fn(),
}))

vi.mock(`@electric-ax/agents-runtime`, async (importOriginal) => {
  const actual = await importOriginal<any>()

  return {
    ...actual,
    createEntityRegistry: createEntityRegistryMock,
    createRuntimeHandler: createRuntimeHandlerMock,
  }
})

vi.mock(`node:http`, async (importOriginal) => {
  const actual = await importOriginal<any>()

  return {
    ...actual,
    createServer: vi.fn(() => ({
      on: serverOnMock,
      listen: serverListenMock,
      address: serverAddressMock,
      close: serverCloseMock,
    })),
  }
})

vi.mock(`../src/electric-agents-registry`, () => ({
  PostgresRegistry: class MockPostgresRegistry {
    initialize(): Promise<void> {
      return registryInitializeMock()
    }

    listEntities(): Promise<{ entities: Array<never> }> {
      return registryListEntitiesMock()
    }

    getEntity(...args: Array<unknown>): Promise<unknown> {
      return registryGetEntityMock(...args)
    }

    getEntityByStream(...args: Array<unknown>): Promise<unknown> {
      return registryGetEntityByStreamMock(...args)
    }

    getEntityType(...args: Array<unknown>): Promise<unknown> {
      return registryGetEntityTypeMock(...args)
    }

    getRunner(...args: Array<unknown>): Promise<unknown> {
      return registryGetRunnerMock(...args)
    }

    expireStaleActiveClaims(...args: Array<unknown>): Promise<Array<unknown>> {
      return registryExpireStaleActiveClaimsMock(...args)
    }

    clearEntityManifestSources(): Promise<void> {
      return Promise.resolve()
    }

    replaceEntityManifestSource(): Promise<void> {
      return Promise.resolve()
    }

    beginDispatchWake(...args: Array<unknown>): Promise<unknown> {
      return registryBeginDispatchWakeMock(...args)
    }

    markWakeDelivered(...args: Array<unknown>): Promise<void> {
      return registryMarkWakeDeliveredMock(...args)
    }

    markWakeFailed(...args: Array<unknown>): Promise<void> {
      return registryMarkWakeFailedMock(...args)
    }

    expireStaleOutstandingWakes(
      ...args: Array<unknown>
    ): Promise<Array<unknown>> {
      return registryExpireStaleOutstandingWakesMock(...args)
    }

    upsertConsumerCallback(...args: Array<unknown>): Promise<void> {
      return registryUpsertConsumerCallbackMock(...args)
    }

    releaseTagOutboxClaims(): Promise<void> {
      return Promise.resolve()
    }

    close(): void {
      registryCloseMock()
    }
  },
}))

vi.mock(`../src/db/index`, () => ({
  createDb: () => ({
    db: {
      select: selectMock,
    },
    client: {
      end: vi.fn(),
    },
  }),
  runMigrations: runMigrationsMock,
}))

vi.mock(`../src/db/schema`, () => ({
  subscriptionWebhooks: {},
  consumerCallbacks: {},
  wakeRegistrations: { sourceUrl: `source_url` },
}))

vi.mock(`../src/wake-registry`, () => ({
  WakeRegistry: class MockWakeRegistry {
    setTimeoutCallback(): void {}
    setDebounceCallback(): void {}
    startSync(): Promise<void> {
      return Promise.resolve()
    }
    stopSync(): Promise<void> {
      return Promise.resolve()
    }
    loadRegistrations(): Promise<void> {
      return Promise.resolve()
    }
  },
}))

vi.mock(`../src/scheduler`, () => ({
  Scheduler: class MockScheduler {
    enqueueCronTick(...args: Array<unknown>): Promise<void> {
      return schedulerEnqueueCronTickMock(...args)
    }

    cancelManifestDelayedSend(...args: Array<unknown>): Promise<void> {
      return schedulerCancelManifestDelayedSendMock(...args)
    }

    syncManifestDelayedSend(...args: Array<unknown>): Promise<void> {
      return schedulerSyncManifestDelayedSendMock(...args)
    }

    start(): Promise<void> {
      return schedulerStartMock()
    }

    stop(): Promise<void> {
      return schedulerStopMock()
    }
  },
}))

vi.mock(`drizzle-orm`, () => ({
  eq: vi.fn(),
}))

vi.mock(`../src/stream-client`, () => ({
  StreamClient: class MockStreamClient {
    exists(): Promise<boolean> {
      return streamExistsMock()
    }

    create(): Promise<void> {
      return streamCreateMock()
    }

    append(...args: Array<unknown>): Promise<unknown> {
      return streamAppendMock(...args)
    }

    readJson(): Promise<Array<Record<string, unknown>>> {
      return streamReadJsonMock()
    }

    mintWakeNotification(...args: Array<unknown>): Promise<unknown> {
      return streamMintWakeNotificationMock(...args)
    }

    getConsumerState(): Promise<null> {
      return Promise.resolve(null)
    }
  },
}))

async function waitForMockCall(mock: { mock: { calls: Array<unknown> } }) {
  for (let i = 0; i < 10; i += 1) {
    if (mock.mock.calls.length > 0) return
    await new Promise((resolve) => setImmediate(resolve))
  }
}

function createIncomingRequest(options: {
  method: string
  url: string
  headers?: Record<string, string>
  body?: unknown
}) {
  const req = new EventEmitter() as EventEmitter & {
    method: string
    url: string
    headers: Record<string, string>
  }
  req.method = options.method
  req.url = options.url
  req.headers = options.headers ?? {}

  process.nextTick(() => {
    if (options.body !== undefined) {
      const body =
        typeof options.body === `string`
          ? options.body
          : JSON.stringify(options.body)
      req.emit(`data`, Buffer.from(body))
    }
    req.emit(`end`)
  })

  return req as any
}

function createServerResponse() {
  return {
    setHeader: vi.fn(),
    writeHead: vi.fn(),
    end: vi.fn(),
  } as any
}

function makeRunnerDispatchEntity(url: string) {
  return {
    url,
    type: `chat`,
    status: `idle`,
    streams: { main: `${url}/main`, error: `${url}/error` },
    subscription_id: `chat-handler`,
    dispatch_policy: { targets: [{ type: `runner`, runnerId: `runner-1` }] },
    write_token: `entity-write-secret`,
    tags: {},
    spawn_args: {},
    created_at: 0,
    updated_at: 0,
  }
}

describe(`ElectricAgentsServer.start`, () => {
  let server: ElectricAgentsServer | null = null

  beforeEach(() => {
    schedulerCancelManifestDelayedSendMock.mockReset()
    schedulerEnqueueCronTickMock.mockReset()
    schedulerSyncManifestDelayedSendMock.mockReset()
    schedulerStartMock.mockReset()
    schedulerStopMock.mockReset()
    registryBeginDispatchWakeMock.mockReset()
    registryCloseMock.mockReset()
    registryExpireStaleActiveClaimsMock.mockReset()
    registryGetEntityMock.mockReset()
    registryGetEntityByStreamMock.mockReset()
    registryGetEntityTypeMock.mockReset()
    registryGetRunnerMock.mockReset()
    registryInitializeMock.mockReset()
    registryListEntitiesMock.mockReset()
    registryMarkWakeDeliveredMock.mockReset()
    registryMarkWakeFailedMock.mockReset()
    registryExpireStaleOutstandingWakesMock.mockReset()
    registryUpsertConsumerCallbackMock.mockReset()
    serverAddressMock.mockReset()
    serverCloseMock.mockReset()
    serverListenMock.mockReset()
    serverOnMock.mockReset()
    selectFromMock.mockReset()
    selectMock.mockReset()
    streamAppendMock.mockReset()
    streamCreateMock.mockReset()
    streamExistsMock.mockReset()
    streamMintWakeNotificationMock.mockReset()
    streamReadJsonMock.mockReset()
    runMigrationsMock.mockReset()
    mockAgentHandlerMock.mockReset()
    mockAgentRegisterTypesMock.mockReset()
    mockAgentAbortWakesMock.mockReset()
    mockAgentDrainWakesMock.mockReset()
    createEntityRegistryMock.mockReset()
    createRuntimeHandlerMock.mockReset()

    runMigrationsMock.mockResolvedValue(undefined)
    schedulerCancelManifestDelayedSendMock.mockResolvedValue(undefined)
    schedulerEnqueueCronTickMock.mockResolvedValue(undefined)
    schedulerSyncManifestDelayedSendMock.mockResolvedValue(undefined)
    schedulerStartMock.mockResolvedValue(undefined)
    schedulerStopMock.mockResolvedValue(undefined)
    registryBeginDispatchWakeMock.mockResolvedValue({ status: `queued` })
    registryExpireStaleActiveClaimsMock.mockResolvedValue([])
    registryGetEntityMock.mockResolvedValue(null)
    registryGetEntityByStreamMock.mockResolvedValue(null)
    registryGetEntityTypeMock.mockResolvedValue(null)
    registryGetRunnerMock.mockResolvedValue(null)
    registryInitializeMock.mockResolvedValue(undefined)
    registryListEntitiesMock.mockResolvedValue({ entities: [] })
    registryMarkWakeDeliveredMock.mockResolvedValue(undefined)
    registryMarkWakeFailedMock.mockResolvedValue(undefined)
    registryExpireStaleOutstandingWakesMock.mockResolvedValue([])
    registryUpsertConsumerCallbackMock.mockResolvedValue(undefined)
    serverAddressMock.mockReturnValue({ port: 4437 })
    serverCloseMock.mockImplementation((callback?: () => void) => {
      callback?.()
    })
    serverListenMock.mockImplementation(
      (_port: number, _host: string, callback?: () => void) => {
        callback?.()
      }
    )
    selectFromMock.mockResolvedValue([])
    selectMock.mockReturnValue({
      from: selectFromMock,
    })
    streamAppendMock.mockResolvedValue({ offset: `42` })
    streamCreateMock.mockResolvedValue(undefined)
    streamExistsMock.mockResolvedValue(true)
    streamMintWakeNotificationMock.mockImplementation(
      (_consumerId: string, request: Record<string, unknown> = {}) =>
        Promise.resolve({
          notification: {
            consumerId: `entity:chat:runner-e2e`,
            epoch: 1,
            wakeId: `wake-runner-e2e`,
            streamPath: `/chat/runner-e2e/main`,
            streams: [{ path: `/chat/runner-e2e/main`, offset: `7` }],
            callback: `https://durable.test/callback`,
            claimToken: `claim-secret`,
            ...request,
          },
        })
    )
    streamReadJsonMock.mockResolvedValue([])
    mockAgentRegisterTypesMock.mockResolvedValue(undefined)
    mockAgentDrainWakesMock.mockResolvedValue(undefined)
    createEntityRegistryMock.mockReturnValue({
      define: vi.fn(),
    })
    createRuntimeHandlerMock.mockReturnValue({
      onEnter: mockAgentHandlerMock,
      registerTypes: mockAgentRegisterTypesMock,
      abortWakes: mockAgentAbortWakesMock,
      drainWakes: mockAgentDrainWakesMock,
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    if (server) {
      await server.stop().catch(() => {})
      server = null
    }
  })

  it(`does not start dispatch recovery loop by default`, async () => {
    vi.useFakeTimers()

    server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable.test`,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
    })

    await server.start()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(registryExpireStaleActiveClaimsMock).not.toHaveBeenCalled()
    expect(registryExpireStaleOutstandingWakesMock).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it(`runs configured periodic dispatch recovery and stop cancels it`, async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`2026-05-09T00:00:10.000Z`))

    server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable.test`,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
      dispatchRecoveryIntervalMs: 1_000,
      staleOutstandingWakeAfterMs: 5_000,
    })

    await server.start()
    expect(registryExpireStaleActiveClaimsMock).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1_000)

    expect(registryExpireStaleActiveClaimsMock).toHaveBeenCalledWith({
      now: new Date(`2026-05-09T00:00:11.000Z`),
    })
    expect(registryExpireStaleOutstandingWakesMock).toHaveBeenCalledWith({
      now: new Date(`2026-05-09T00:00:11.000Z`),
      staleBefore: new Date(`2026-05-09T00:00:06.000Z`),
    })

    await server.stop()
    registryExpireStaleActiveClaimsMock.mockClear()
    registryExpireStaleOutstandingWakesMock.mockClear()

    await vi.advanceTimersByTimeAsync(5_000)

    expect(registryExpireStaleActiveClaimsMock).not.toHaveBeenCalled()
    expect(registryExpireStaleOutstandingWakesMock).not.toHaveBeenCalled()

    vi.useRealTimers()
  })

  it(`prevents overlapping periodic dispatch recovery runs`, async () => {
    vi.useFakeTimers()

    let resolveExpired!: (value: Array<unknown>) => void
    registryExpireStaleActiveClaimsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveExpired = resolve
      })
    )

    server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable.test`,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
      dispatchRecoveryIntervalMs: 1_000,
    })

    await server.start()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(registryExpireStaleActiveClaimsMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(5_000)
    expect(registryExpireStaleActiveClaimsMock).toHaveBeenCalledTimes(1)

    resolveExpired([])
    await vi.runAllTicks()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(registryExpireStaleActiveClaimsMock).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it(`awaits an active periodic dispatch recovery run before shutdown cleanup`, async () => {
    vi.useFakeTimers()

    let resolveExpired!: (value: Array<unknown>) => void
    registryExpireStaleActiveClaimsMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveExpired = resolve
      })
    )

    server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable.test`,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
      dispatchRecoveryIntervalMs: 1_000,
    })

    await server.start()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(registryExpireStaleActiveClaimsMock).toHaveBeenCalledTimes(1)

    const stopPromise = server.stop()
    await vi.runAllTicks()

    expect(serverCloseMock).not.toHaveBeenCalled()
    expect(schedulerStopMock).not.toHaveBeenCalled()

    resolveExpired([])
    await stopPromise
    server = null

    expect(serverCloseMock).toHaveBeenCalled()
    expect(schedulerStopMock).toHaveBeenCalled()

    vi.useRealTimers()
  })

  it(`rejects startup and cleans up when scheduler startup fails`, async () => {
    schedulerStartMock.mockRejectedValueOnce(new Error(`scheduler exploded`))

    server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable.test`,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
    })

    await expect(server.start()).rejects.toThrow(`scheduler exploded`)
    expect(schedulerStartMock).toHaveBeenCalledOnce()
    expect(schedulerStopMock).toHaveBeenCalledOnce()
    expect(registryCloseMock).toHaveBeenCalledOnce()
    expect(serverCloseMock).toHaveBeenCalledOnce()
    expect(() => server!.url).toThrow(`Server not started`)
  })

  it(`continues startup when one cron rehydration row is invalid`, async () => {
    selectFromMock.mockResolvedValueOnce([
      { sourceUrl: `/_cron/not-a-valid-cron` },
      {
        sourceUrl: `/_cron/${Buffer.from(
          JSON.stringify({
            expression: `*/5 * * * *`,
            timezone: `UTC`,
          })
        ).toString(`base64url`)}`,
      },
    ])

    server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable.test`,
      port: 0,
      postgresUrl: `postgres://electric_agents:electric_agents@localhost:5432/electric_agents`,
    })

    await expect(server.start()).resolves.toMatch(/^http:\/\//)
    expect(streamExistsMock).toHaveBeenCalled()
    expect(schedulerStartMock).toHaveBeenCalledOnce()
  })

  it(`rehydrates pending future_send manifest schedules on startup`, async () => {
    registryListEntitiesMock.mockResolvedValueOnce({
      entities: [
        {
          url: `/chat/test`,
          streams: { main: `/chat/test/main` },
        },
      ],
    })
    streamReadJsonMock.mockResolvedValueOnce([
      {
        type: `manifest`,
        key: `schedule:say_hi`,
        value: {
          key: `schedule:say_hi`,
          kind: `schedule`,
          id: `say_hi`,
          scheduleType: `future_send`,
          fireAt: `2026-04-10T02:30:00.000Z`,
          targetUrl: `/chat/test`,
          payload: { text: `hi` },
          producerId: `future-send-server`,
          status: `pending`,
        },
        headers: {
          operation: `upsert`,
        },
      },
    ])

    server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable.test`,
      port: 0,
      postgresUrl: `postgres://electric_agents:electric_agents@localhost:5432/electric_agents`,
    })

    await expect(server.start()).resolves.toMatch(/^http:\/\//)
    expect(schedulerSyncManifestDelayedSendMock).toHaveBeenCalledWith(
      `/chat/test`,
      `schedule:say_hi`,
      expect.objectContaining({
        entityUrl: `/chat/test`,
        producerId: `future-send-server`,
      }),
      new Date(`2026-04-10T02:30:00.000Z`)
    )
  })

  it(`registers the mock chat agent when mockStreamFn is provided`, async () => {
    const streamFn = vi.fn()

    server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable.test`,
      mockStreamFn: streamFn as any,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
    })

    await expect(server.start()).resolves.toMatch(/^http:\/\//)
    expect(createEntityRegistryMock).toHaveBeenCalledOnce()
    expect(createRuntimeHandlerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: `http://127.0.0.1:4437`,
        serveEndpoint: `http://127.0.0.1:4437/_electric/mock-agent-handler`,
        subscriptionPathForType: expect.any(Function),
      })
    )
    expect(mockAgentRegisterTypesMock).toHaveBeenCalledOnce()
  })

  it(`uses configured baseUrl for public mock agent registration URLs`, async () => {
    const streamFn = vi.fn()

    server = new ElectricAgentsServer({
      baseUrl: `https://agents.example.com/`,
      durableStreamsUrl: `http://durable.test`,
      mockStreamFn: streamFn as any,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
    })

    await expect(server.start()).resolves.toMatch(/^http:\/\//)
    expect(createRuntimeHandlerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: `https://agents.example.com`,
        serveEndpoint: `https://agents.example.com/_electric/mock-agent-handler`,
        subscriptionPathForType: expect.any(Function),
      })
    )
  })

  it(`rewrites dispatch notification callbacks through callback-forward URLs`, async () => {
    server = new ElectricAgentsServer({
      baseUrl: `https://agents.example.com/`,
      durableStreamsUrl: `http://durable.test`,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
    })

    await server.start()

    const callbackUrlForNotification = (server as any).dispatchWakeRouter
      .callbackUrlForNotification as Function
    const rewritten = await callbackUrlForNotification({
      consumerId: `entity:chat:one`,
      callback: `https://durable.test/consumers/entity%3Achat%3Aone/callback`,
      streamPath: `/chat/one/main`,
    })

    expect(registryUpsertConsumerCallbackMock).toHaveBeenCalledWith({
      consumerId: `entity:chat:one`,
      callbackUrl: `https://durable.test/consumers/entity%3Achat%3Aone/callback`,
      primaryStream: `/chat/one/main`,
    })
    expect(rewritten).toBe(
      `https://agents.example.com/_electric/callback-forward/entity%3Achat%3Aone`
    )
  })

  it(`dispatches runner wake after a public append succeeds`, async () => {
    server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable.test`,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
    })

    await server.start()

    const entity = makeRunnerDispatchEntity(`/chat/public-append`)
    ;(server as any).activeClaimWriteTokens.set(entity.streams.main, {
      token: `claim-write-secret`,
      consumerId: `entity:chat:public-append`,
    })
    registryGetEntityByStreamMock.mockResolvedValue(entity)
    registryGetRunnerMock.mockResolvedValue({
      id: `runner-1`,
      owner_user_id: `user-1`,
      label: `Runner 1`,
      kind: `local`,
      admin_status: `enabled`,
      liveness: `online`,
      wake_stream: `/runners/runner-1/wake`,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    })

    let resolveFetch!: (response: Response) => void
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve
    })
    const fetchMock = vi
      .spyOn(globalThis, `fetch`)
      .mockImplementation(() => fetchPromise)

    try {
      const req = createIncomingRequest({
        method: `POST`,
        url: `/chat/public-append/main`,
        headers: { authorization: `Bearer claim-write-secret` },
        body: { type: `message`, key: `msg-1`, value: { text: `hello` } },
      })
      const res = createServerResponse()

      const handled = (server as any).handleRequest(req, res)
      await new Promise((resolve) => setImmediate(resolve))

      expect(fetchMock).toHaveBeenCalledWith(
        new URL(`/chat/public-append/main`, `http://durable.test`),
        expect.objectContaining({ method: `POST` })
      )
      expect(streamMintWakeNotificationMock).not.toHaveBeenCalled()
      expect(registryBeginDispatchWakeMock).not.toHaveBeenCalled()
      expect(registryGetRunnerMock).not.toHaveBeenCalled()
      expect(streamAppendMock).not.toHaveBeenCalled()

      resolveFetch(
        new Response(JSON.stringify({ offset: `9` }), {
          status: 201,
          headers: { 'content-type': `application/json` },
        })
      )
      await handled

      expect(res.writeHead).toHaveBeenCalledWith(
        201,
        expect.objectContaining({ 'content-type': `application/json` })
      )
      await waitForMockCall(streamAppendMock)
      expect(streamAppendMock).toHaveBeenCalledTimes(1)
      expect(streamAppendMock.mock.calls[0]![0]).toBe(`/runners/runner-1/wake`)
    } finally {
      fetchMock.mockRestore()
    }
  })

  it(`does not dispatch runner wake when public append upstream fails`, async () => {
    server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable.test`,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
    })

    await server.start()

    const entity = makeRunnerDispatchEntity(`/chat/public-append-fail`)
    ;(server as any).activeClaimWriteTokens.set(entity.streams.main, {
      token: `claim-write-secret`,
      consumerId: `entity:chat:public-append-fail`,
    })
    registryGetEntityByStreamMock.mockResolvedValue(entity)
    const fetchMock = vi.spyOn(globalThis, `fetch`).mockResolvedValue(
      new Response(JSON.stringify({ error: `boom` }), {
        status: 500,
        headers: { 'content-type': `application/json` },
      })
    )

    try {
      const req = createIncomingRequest({
        method: `POST`,
        url: `/chat/public-append-fail/main`,
        headers: { authorization: `Bearer claim-write-secret` },
        body: { type: `message`, key: `msg-1` },
      })
      const res = createServerResponse()

      await (server as any).handleRequest(req, res)
      await new Promise((resolve) => setImmediate(resolve))

      expect(res.writeHead).toHaveBeenCalledWith(
        500,
        expect.objectContaining({ 'content-type': `application/json` })
      )
      expect(streamMintWakeNotificationMock).not.toHaveBeenCalled()
      expect(registryBeginDispatchWakeMock).not.toHaveBeenCalled()
      expect(streamAppendMock).not.toHaveBeenCalled()
    } finally {
      fetchMock.mockRestore()
    }
  })

  it(`queues an appended entity wake onto a registered runner wake stream`, async () => {
    server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable.test`,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
    })

    await server.start()

    registryGetRunnerMock.mockResolvedValue({
      id: `runner-1`,
      owner_user_id: `user-1`,
      label: `Runner 1`,
      kind: `local`,
      admin_status: `enabled`,
      liveness: `online`,
      wake_stream: `/runners/runner-1/wake`,
      created_at: new Date(0).toISOString(),
      updated_at: new Date(0).toISOString(),
    })

    const entity = {
      url: `/chat/runner-e2e`,
      type: `chat`,
      status: `idle`,
      streams: {
        main: `/chat/runner-e2e/main`,
        error: `/chat/runner-e2e/error`,
      },
      subscription_id: `chat-handler`,
      dispatch_policy: { targets: [{ type: `runner`, runnerId: `runner-1` }] },
      write_token: `entity-write-secret`,
      tags: { project: `demo` },
      spawn_args: { prompt: `hello` },
      created_at: 0,
      updated_at: 0,
    }

    await (server as any).dispatchWakeForEntityAppend(entity, {
      type: `message`,
      key: `msg-1`,
      value: { text: `hello` },
    })

    expect(streamMintWakeNotificationMock).toHaveBeenCalledWith(
      `entity:chat:runner-e2e`,
      expect.objectContaining({
        streamPath: `/chat/runner-e2e/main`,
        triggerEvent: `message`,
      })
    )
    expect(registryBeginDispatchWakeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entityUrl: `/chat/runner-e2e`,
        target: { type: `runner`, runnerId: `runner-1` },
        runnerWakeStream: `/runners/runner-1/wake`,
        reason: `message`,
      })
    )
    expect(streamAppendMock).toHaveBeenCalledTimes(1)
    expect(streamAppendMock.mock.calls[0]![0]).toBe(`/runners/runner-1/wake`)
    const runnerWakePayload = JSON.parse(
      streamAppendMock.mock.calls[0]![1] as string
    )
    expect(runnerWakePayload).toEqual(
      expect.objectContaining({
        consumerId: `entity:chat:runner-e2e`,
        wakeId: `wake-runner-e2e`,
        triggerEvent: `message`,
        callback: `http://127.0.0.1:4437/_electric/callback-forward/entity%3Achat%3Arunner-e2e`,
        claimToken: `claim-secret`,
        streamPath: `/chat/runner-e2e/main`,
        streams: [{ path: `/chat/runner-e2e/main`, offset: `7` }],
        entity: expect.objectContaining({
          url: `/chat/runner-e2e`,
        }),
      })
    )
    expect(runnerWakePayload).not.toHaveProperty(`writeToken`)
    expect(runnerWakePayload.entity).not.toHaveProperty(`writeToken`)
    expect(registryUpsertConsumerCallbackMock).toHaveBeenCalledWith({
      consumerId: `entity:chat:runner-e2e`,
      callbackUrl: `https://durable.test/callback`,
      primaryStream: `/chat/runner-e2e/main`,
    })
    expect(registryMarkWakeDeliveredMock).toHaveBeenCalledWith({
      wakeId: `wake-runner-e2e`,
      runnerWakeStream: `/runners/runner-1/wake`,
      runnerWakeStreamOffset: `42`,
    })
  })

  it(`dispatches appended entity wakes only for entities with stored dispatch_policy`, async () => {
    server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable.test`,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
    })

    const notification = {
      consumerId: `entity:chat:one`,
      epoch: 1,
      wakeId: `wake-1`,
      streamPath: `/chat/one/main`,
      streams: [{ path: `/chat/one/main`, offset: `7` }],
      callback: `https://durable.test/callback`,
      claimToken: `claim-secret`,
    }
    const enriched = { ...notification, triggerEvent: `message` }
    const router = {
      resolveSingleTarget: vi.fn((policy) => policy.targets[0]),
      mintNotificationForEntity: vi.fn().mockResolvedValue({ notification }),
      enrichNotificationForEntity: vi.fn().mockResolvedValue(enriched),
      dispatchToTarget: vi.fn().mockResolvedValue({ status: `queued` }),
    }
    ;(server as any).dispatchWakeRouter = router

    const entity = {
      url: `/chat/one`,
      type: `chat`,
      status: `idle`,
      streams: { main: `/chat/one/main`, error: `/chat/one/error` },
      subscription_id: `chat-handler`,
      dispatch_policy: { targets: [{ type: `runner`, runnerId: `runner-1` }] },
      write_token: `write-secret`,
      tags: {},
      created_at: 0,
      updated_at: 0,
    }

    await (server as any).dispatchWakeForEntityAppend(entity, {
      type: `message`,
      key: `msg-1`,
    })

    expect(router.resolveSingleTarget).toHaveBeenCalledWith(
      entity.dispatch_policy
    )
    expect(router.mintNotificationForEntity).toHaveBeenCalledWith(entity, {
      triggerEvent: `message`,
    })
    expect(router.enrichNotificationForEntity).toHaveBeenCalledWith(
      notification,
      entity
    )
    expect(router.dispatchToTarget).toHaveBeenCalledWith(
      { type: `runner`, runnerId: `runner-1` },
      enriched,
      entity
    )

    router.resolveSingleTarget.mockClear()
    router.mintNotificationForEntity.mockClear()
    router.enrichNotificationForEntity.mockClear()
    router.dispatchToTarget.mockClear()

    await (server as any).dispatchWakeForEntityAppend(
      { ...entity, dispatch_policy: undefined },
      { type: `message` }
    )

    expect(router.resolveSingleTarget).not.toHaveBeenCalled()
    expect(router.mintNotificationForEntity).not.toHaveBeenCalled()
    expect(router.enrichNotificationForEntity).not.toHaveBeenCalled()
    expect(router.dispatchToTarget).not.toHaveBeenCalled()
  })

  it(`dispatches recovered expired claims with pending work and dispatch_policy`, async () => {
    server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable.test`,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
    })

    const recoveryItem = {
      entityUrl: `/chat/recovered`,
      pendingSourceStreams: [{ path: `/chat/recovered/main`, offset: `11` }],
    }
    const entity = {
      url: `/chat/recovered`,
      type: `chat`,
      status: `idle`,
      streams: {
        main: `/chat/recovered/main`,
        error: `/chat/recovered/error`,
      },
      subscription_id: `chat-handler`,
      dispatch_policy: { targets: [{ type: `runner`, runnerId: `runner-1` }] },
      write_token: `write-secret`,
      tags: {},
      created_at: 0,
      updated_at: 0,
    }
    const notification = {
      consumerId: `entity:chat:recovered`,
      epoch: 2,
      wakeId: `wake-recovered`,
      streamPath: `/chat/recovered/main`,
      streams: recoveryItem.pendingSourceStreams,
      callback: `https://durable.test/callback`,
      claimToken: `claim-secret`,
    }
    const enriched = { ...notification, triggerEvent: `expired_claim_recovery` }
    const router = {
      resolveSingleTarget: vi.fn((policy) => policy.targets[0]),
      mintNotificationForEntity: vi.fn().mockResolvedValue({ notification }),
      enrichNotificationForEntity: vi.fn().mockResolvedValue(enriched),
      dispatchToTarget: vi.fn().mockResolvedValue({ status: `queued` }),
    }
    const registry = {
      expireStaleActiveClaims: vi.fn().mockResolvedValue([recoveryItem]),
      getEntity: vi.fn().mockResolvedValue(entity),
    }
    ;(server as any).registry = registry
    ;(server as any).dispatchWakeRouter = router

    await expect(
      server.recoverExpiredDispatchClaimsOnce({
        now: new Date(`2026-05-08T00:00:00.000Z`),
        limit: 10,
      })
    ).resolves.toEqual([recoveryItem])

    expect(registry.expireStaleActiveClaims).toHaveBeenCalledWith({
      now: new Date(`2026-05-08T00:00:00.000Z`),
      limit: 10,
    })
    expect(registry.getEntity).toHaveBeenCalledWith(`/chat/recovered`)
    expect(router.mintNotificationForEntity).toHaveBeenCalledWith(entity, {
      streams: recoveryItem.pendingSourceStreams,
      triggerEvent: `expired_claim_recovery`,
    })
    expect(router.dispatchToTarget).toHaveBeenCalledWith(
      { type: `runner`, runnerId: `runner-1` },
      enriched,
      entity
    )
  })

  it(`skips recovered expired claims without pending work or dispatch_policy`, async () => {
    server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable.test`,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
    })

    const withNoPending = {
      entityUrl: `/chat/no-pending`,
      pendingSourceStreams: [],
    }
    const withoutPolicy = {
      entityUrl: `/chat/no-policy`,
      pendingSourceStreams: [{ path: `/chat/no-policy/main`, offset: `12` }],
    }
    const router = {
      resolveSingleTarget: vi.fn(),
      mintNotificationForEntity: vi.fn(),
      enrichNotificationForEntity: vi.fn(),
      dispatchToTarget: vi.fn(),
    }
    const registry = {
      expireStaleActiveClaims: vi
        .fn()
        .mockResolvedValue([withNoPending, withoutPolicy]),
      getEntity: vi.fn().mockImplementation(async (url: string) => ({
        url,
        type: `chat`,
        status: `idle`,
        streams: { main: `${url}/main`, error: `${url}/error` },
        subscription_id: `chat-handler`,
        write_token: `write-secret`,
        tags: {},
        created_at: 0,
        updated_at: 0,
      })),
    }
    ;(server as any).registry = registry
    ;(server as any).dispatchWakeRouter = router

    await expect(server.recoverExpiredDispatchClaimsOnce()).resolves.toEqual([
      withNoPending,
      withoutPolicy,
    ])

    expect(registry.getEntity).toHaveBeenCalledTimes(1)
    expect(registry.getEntity).toHaveBeenCalledWith(`/chat/no-policy`)
    expect(router.resolveSingleTarget).not.toHaveBeenCalled()
    expect(router.mintNotificationForEntity).not.toHaveBeenCalled()
    expect(router.enrichNotificationForEntity).not.toHaveBeenCalled()
    expect(router.dispatchToTarget).not.toHaveBeenCalled()
  })

  it(`skips worker-pool dispatch targets for append wiring`, async () => {
    server = new ElectricAgentsServer({
      durableStreamsUrl: `http://durable.test`,
      port: 0,
      postgresUrl: TEST_POSTGRES_URL,
    })

    const router = {
      resolveSingleTarget: vi.fn(() => ({
        type: `worker-pool`,
        workerPoolId: `pool-1`,
      })),
      mintNotificationForEntity: vi.fn(),
      enrichNotificationForEntity: vi.fn(),
      dispatchToTarget: vi.fn(),
    }
    ;(server as any).dispatchWakeRouter = router

    await (server as any).dispatchWakeForEntityAppend(
      {
        url: `/chat/one`,
        type: `chat`,
        status: `idle`,
        streams: { main: `/chat/one/main`, error: `/chat/one/error` },
        subscription_id: `chat-handler`,
        dispatch_policy: {
          targets: [{ type: `worker-pool`, workerPoolId: `pool-1` }],
        },
        write_token: `write-secret`,
        tags: {},
        created_at: 0,
        updated_at: 0,
      },
      { type: `message` }
    )

    expect(router.resolveSingleTarget).toHaveBeenCalledOnce()
    expect(router.mintNotificationForEntity).not.toHaveBeenCalled()
    expect(router.enrichNotificationForEntity).not.toHaveBeenCalled()
    expect(router.dispatchToTarget).not.toHaveBeenCalled()
  })
})
