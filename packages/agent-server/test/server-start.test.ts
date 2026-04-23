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
  registryCloseMock,
  registryInitializeMock,
  registryListEntitiesMock,
  runMigrationsMock,
  selectFromMock,
  selectMock,
  serverAddressMock,
  serverCloseMock,
  serverListenMock,
  serverOnMock,
  streamCreateMock,
  streamExistsMock,
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
  registryCloseMock: vi.fn(),
  registryInitializeMock: vi.fn(),
  registryListEntitiesMock: vi.fn(),
  runMigrationsMock: vi.fn(),
  selectFromMock: vi.fn(),
  selectMock: vi.fn(),
  serverAddressMock: vi.fn(),
  serverCloseMock: vi.fn(),
  serverListenMock: vi.fn(),
  serverOnMock: vi.fn(),
  streamCreateMock: vi.fn(),
  streamExistsMock: vi.fn(),
  streamReadJsonMock: vi.fn(),
}))

vi.mock(`@electric-ax/agent-runtime`, async (importOriginal) => {
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

    clearEntityManifestSources(): Promise<void> {
      return Promise.resolve()
    }

    replaceEntityManifestSource(): Promise<void> {
      return Promise.resolve()
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

    readJson(): Promise<Array<Record<string, unknown>>> {
      return streamReadJsonMock()
    }

    getConsumerState(): Promise<null> {
      return Promise.resolve(null)
    }
  },
}))

describe(`ElectricAgentsServer.start`, () => {
  let server: ElectricAgentsServer | null = null

  beforeEach(() => {
    schedulerCancelManifestDelayedSendMock.mockReset()
    schedulerEnqueueCronTickMock.mockReset()
    schedulerSyncManifestDelayedSendMock.mockReset()
    schedulerStartMock.mockReset()
    schedulerStopMock.mockReset()
    registryCloseMock.mockReset()
    registryInitializeMock.mockReset()
    registryListEntitiesMock.mockReset()
    serverAddressMock.mockReset()
    serverCloseMock.mockReset()
    serverListenMock.mockReset()
    serverOnMock.mockReset()
    selectFromMock.mockReset()
    selectMock.mockReset()
    streamCreateMock.mockReset()
    streamExistsMock.mockReset()
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
    registryInitializeMock.mockResolvedValue(undefined)
    registryListEntitiesMock.mockResolvedValue({ entities: [] })
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
    streamCreateMock.mockResolvedValue(undefined)
    streamExistsMock.mockResolvedValue(true)
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
    if (server) {
      await server.stop().catch(() => {})
      server = null
    }
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
})
