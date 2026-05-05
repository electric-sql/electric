import { describe, expect, it, vi } from 'vitest'
import {
  resolveElectricAgentsEntrypointOptions,
  runElectricAgentsEntrypoint,
} from '../src/entrypoint-lib'
import type { ElectricAgentsEntrypointOptions } from '../src/entrypoint-lib'

const { embeddedStreamsCtorMock } = vi.hoisted(() => ({
  embeddedStreamsCtorMock: vi.fn(),
}))

vi.mock(`@durable-streams/server`, () => ({
  DurableStreamTestServer: class MockDurableStreamTestServer {
    constructor(options: unknown) {
      embeddedStreamsCtorMock(options)
    }

    start(): Promise<string> {
      return Promise.resolve(`http://127.0.0.1:3901`)
    }

    stop(): Promise<void> {
      return Promise.resolve()
    }
  },
}))

describe(`resolveElectricAgentsEntrypointOptions`, () => {
  it(`reads the standalone server config from environment variables`, () => {
    expect(
      resolveElectricAgentsEntrypointOptions(
        {
          ELECTRIC_AGENTS_DURABLE_STREAMS_URL: `http://streams:8787`,
          DATABASE_URL: `postgres://electric_agents:electric_agents@postgres:5432/electric_agents`,
          ELECTRIC_URL: `http://electric:3000`,
          ELECTRIC_AGENTS_ELECTRIC_SECRET: `electric-secret`,
          ELECTRIC_AGENTS_BASE_URL: `https://electric-agents.example.com`,
          HOST: `0.0.0.0`,
          PORT: `8080`,
          ELECTRIC_AGENTS_WORKING_DIRECTORY: `/workspace/app`,
        },
        `/fallback/cwd`
      )
    ).toEqual({
      baseUrl: `https://electric-agents.example.com`,
      durableStreamsUrl: `http://streams:8787`,
      electricSecret: `electric-secret`,
      electricUrl: `http://electric:3000`,
      host: `0.0.0.0`,
      port: 8080,
      postgresUrl: `postgres://electric_agents:electric_agents@postgres:5432/electric_agents`,
      workingDirectory: `/workspace/app`,
    })
  })

  it(`uses sane defaults for container startup`, () => {
    expect(
      resolveElectricAgentsEntrypointOptions(
        {
          STREAMS_URL: `http://streams:8787`,
          DATABASE_URL: `postgres://electric_agents:electric_agents@postgres:5432/electric_agents`,
        },
        `/workspace/default`
      )
    ).toEqual({
      baseUrl: undefined,
      durableStreamsUrl: `http://streams:8787`,
      electricSecret: undefined,
      electricUrl: undefined,
      host: `0.0.0.0`,
      port: 4437,
      postgresUrl: `postgres://electric_agents:electric_agents@postgres:5432/electric_agents`,
      workingDirectory: `/workspace/default`,
    })
  })

  it(`fails fast when required dependencies are missing`, () => {
    expect(() =>
      resolveElectricAgentsEntrypointOptions({
        DATABASE_URL: `postgres://electric_agents:electric_agents@postgres:5432/electric_agents`,
      })
    ).not.toThrow()

    expect(() =>
      resolveElectricAgentsEntrypointOptions({
        DURABLE_STREAMS_URL: `http://streams:8787`,
      })
    ).toThrow(/Postgres connection URL/)
  })

  it(`rejects invalid ports`, () => {
    expect(() =>
      resolveElectricAgentsEntrypointOptions({
        DURABLE_STREAMS_URL: `http://streams:8787`,
        DATABASE_URL: `postgres://electric_agents:electric_agents@postgres:5432/electric_agents`,
        PORT: `abc`,
      })
    ).toThrow(/Invalid ELECTRIC_AGENTS port/)
  })
})

describe(`runElectricAgentsEntrypoint`, () => {
  it(`constructs and starts ElectricAgentsServer with resolved options`, async () => {
    embeddedStreamsCtorMock.mockReset()

    const start = vi.fn(() => Promise.resolve(`http://127.0.0.1:4437`))
    const stop = vi.fn(() => Promise.resolve())
    const createServer = vi.fn(
      (options: ElectricAgentsEntrypointOptions) =>
        ({
          start,
          stop,
          options,
        }) as const
    )

    const started = await runElectricAgentsEntrypoint({
      env: {
        ELECTRIC_AGENTS_DURABLE_STREAMS_URL: `http://streams:8787`,
        ELECTRIC_AGENTS_DATABASE_URL: `postgres://electric_agents:electric_agents@postgres:5432/electric_agents`,
        ELECTRIC_AGENTS_ELECTRIC_URL: `http://electric:3000`,
        ELECTRIC_AGENTS_ELECTRIC_SECRET: `electric-secret`,
        ELECTRIC_AGENTS_PORT: `7777`,
      },
      cwd: `/workspace/app`,
      createServer,
    })

    expect(createServer).toHaveBeenCalledWith({
      baseUrl: undefined,
      durableStreamsUrl: `http://streams:8787`,
      electricSecret: `electric-secret`,
      electricUrl: `http://electric:3000`,
      host: `0.0.0.0`,
      port: 7777,
      postgresUrl: `postgres://electric_agents:electric_agents@postgres:5432/electric_agents`,
      workingDirectory: `/workspace/app`,
    })
    expect(start).toHaveBeenCalledTimes(1)
    expect(stop).not.toHaveBeenCalled()
    expect(started.url).toBe(`http://127.0.0.1:4437`)
  })

  it(`starts an embedded durable streams server when no external URL is configured`, async () => {
    embeddedStreamsCtorMock.mockReset()

    const start = vi.fn(() => Promise.resolve(`http://127.0.0.1:4437`))
    const createServer = vi.fn(
      (options: ElectricAgentsEntrypointOptions) =>
        ({
          start,
          stop: vi.fn(() => Promise.resolve()),
          options,
        }) as const
    )

    await runElectricAgentsEntrypoint({
      env: {
        ELECTRIC_AGENTS_DATABASE_URL: `postgres://electric_agents:electric_agents@postgres:5432/electric_agents`,
        ELECTRIC_AGENTS_STREAMS_DATA_DIR: `/streams-data`,
      },
      cwd: `/workspace/app`,
      createServer,
    })

    const options = createServer.mock.calls[0]?.[0] as
      | (ElectricAgentsEntrypointOptions & { durableStreamsServer?: unknown })
      | undefined

    expect(options?.durableStreamsUrl).toBeUndefined()
    expect(options?.durableStreamsServer).toBeDefined()
    expect(embeddedStreamsCtorMock).toHaveBeenCalledWith({
      dataDir: `/streams-data`,
      host: `127.0.0.1`,
      port: 0,
      webhooks: true,
    })
  })

  it(`persists embedded durable streams under the working directory by default`, async () => {
    embeddedStreamsCtorMock.mockReset()

    const createServer = vi.fn(
      (options: ElectricAgentsEntrypointOptions) =>
        ({
          start: vi.fn(() => Promise.resolve(`http://127.0.0.1:4437`)),
          stop: vi.fn(() => Promise.resolve()),
          options,
        }) as const
    )

    await runElectricAgentsEntrypoint({
      env: {
        ELECTRIC_AGENTS_DATABASE_URL: `postgres://electric_agents:electric_agents@postgres:5432/electric_agents`,
      },
      cwd: `/workspace/app`,
      createServer,
    })

    expect(embeddedStreamsCtorMock).toHaveBeenCalledWith({
      dataDir: `/workspace/app/.streams-data`,
      host: `127.0.0.1`,
      port: 0,
      webhooks: true,
    })
  })
})
