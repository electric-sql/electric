import { DurableStreamTestServer } from '@durable-streams/server'
import { ElectricAgentsServer } from './server.js'
import type { ElectricAgentsServerOptions } from './server.js'

const DEFAULT_HOST = `0.0.0.0`
const DEFAULT_PORT = 4437
const DEFAULT_STREAMS_HOST = `127.0.0.1`

type EnvSource = Record<string, string | undefined>

export interface ElectricAgentsEntrypointOptions
  extends ElectricAgentsServerOptions {}

export interface ElectricAgentsEntrypointServer {
  start: () => Promise<string>
  stop: () => Promise<void>
}

export interface RunElectricAgentsEntrypointOptions {
  env?: EnvSource
  cwd?: string
  createServer?: (
    options: ElectricAgentsEntrypointOptions
  ) => ElectricAgentsEntrypointServer
}

function readEnv(env: EnvSource, names: Array<string>): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim()
    if (value) {
      return value
    }
  }
  return undefined
}

function readRequiredEnv(
  env: EnvSource,
  names: Array<string>,
  description: string
): string {
  const value = readEnv(env, names)
  if (value) {
    return value
  }

  throw new Error(
    `Missing ${description}. Set one of: ${names.map((name) => `"${name}"`).join(`, `)}`
  )
}

function readPort(env: EnvSource): number {
  const raw = readEnv(env, [`ELECTRIC_AGENTS_PORT`, `PORT`])
  if (!raw) {
    return DEFAULT_PORT
  }

  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `Invalid ELECTRIC_AGENTS port "${raw}". Expected an integer between 1 and 65535.`
    )
  }

  return port
}

function validateUrl(name: string, value: string): string {
  try {
    new URL(value)
    return value
  } catch {
    throw new Error(`Invalid ${name}: "${value}"`)
  }
}

function readOptionalPort(
  env: EnvSource,
  names: Array<string>,
  description: string
): number | undefined {
  const raw = readEnv(env, names)
  if (!raw) {
    return undefined
  }

  const port = Number(raw)
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(
      `Invalid ${description} "${raw}". Expected an integer between 0 and 65535.`
    )
  }

  return port
}

export function resolveElectricAgentsEntrypointOptions(
  env: EnvSource = process.env,
  cwd = process.cwd()
): ElectricAgentsEntrypointOptions {
  const durableStreamsUrl = readEnv(env, [
    `ELECTRIC_AGENTS_DURABLE_STREAMS_URL`,
    `DURABLE_STREAMS_URL`,
    `STREAMS_URL`,
  ])
  const postgresUrl = validateUrl(
    `Postgres URL`,
    readRequiredEnv(
      env,
      [`ELECTRIC_AGENTS_DATABASE_URL`, `DATABASE_URL`],
      `Postgres connection URL`
    )
  )

  const electricUrl = readEnv(env, [
    `ELECTRIC_AGENTS_ELECTRIC_URL`,
    `ELECTRIC_URL`,
  ])
  const electricSecret = readEnv(env, [`ELECTRIC_AGENTS_ELECTRIC_SECRET`])
  const baseUrl = readEnv(env, [`ELECTRIC_AGENTS_BASE_URL`, `BASE_URL`])

  return {
    baseUrl: baseUrl ? validateUrl(`base URL`, baseUrl) : undefined,
    durableStreamsUrl: durableStreamsUrl
      ? validateUrl(`durable streams URL`, durableStreamsUrl)
      : undefined,
    postgresUrl,
    electricUrl: electricUrl
      ? validateUrl(`Electric URL`, electricUrl)
      : undefined,
    electricSecret,
    host: readEnv(env, [`ELECTRIC_AGENTS_HOST`, `HOST`]) ?? DEFAULT_HOST,
    port: readPort(env),
    workingDirectory:
      readEnv(env, [
        `ELECTRIC_AGENTS_WORKING_DIRECTORY`,
        `WORKING_DIRECTORY`,
      ]) ?? cwd,
  }
}

function createEmbeddedStreamsServer(
  env: EnvSource,
  cwd: string
): DurableStreamTestServer | undefined {
  const externalUrl = readEnv(env, [
    `ELECTRIC_AGENTS_DURABLE_STREAMS_URL`,
    `DURABLE_STREAMS_URL`,
    `STREAMS_URL`,
  ])
  if (externalUrl) {
    return undefined
  }

  const dataDir =
    readEnv(env, [`ELECTRIC_AGENTS_STREAMS_DATA_DIR`, `STREAMS_DATA_DIR`]) ??
    `${cwd}/.streams-data`

  return new DurableStreamTestServer({
    host:
      readEnv(env, [`ELECTRIC_AGENTS_STREAMS_HOST`, `STREAMS_HOST`]) ??
      DEFAULT_STREAMS_HOST,
    port:
      readOptionalPort(
        env,
        [`ELECTRIC_AGENTS_STREAMS_PORT`, `STREAMS_PORT`],
        `embedded streams port`
      ) ?? 0,
    dataDir,
    webhooks: true,
  })
}

export async function runElectricAgentsEntrypoint({
  env = process.env,
  cwd = process.cwd(),
  createServer = (options) => new ElectricAgentsServer(options),
}: RunElectricAgentsEntrypointOptions = {}): Promise<{
  options: ElectricAgentsEntrypointOptions
  server: ElectricAgentsEntrypointServer
  url: string
}> {
  const embeddedStreamsServer = createEmbeddedStreamsServer(env, cwd)
  const options = {
    ...resolveElectricAgentsEntrypointOptions(env, cwd),
    durableStreamsServer: embeddedStreamsServer,
  }
  const server = createServer(options)
  const url = await server.start()

  return { options, server, url }
}

export async function main(): Promise<void> {
  try {
    process.loadEnvFile()
  } catch {}

  let server: ElectricAgentsEntrypointServer | null = null
  let stopping: Promise<void> | null = null

  const stop = async (exitCode: number): Promise<never> => {
    if (!stopping) {
      stopping =
        server?.stop().catch((error) => {
          console.error(`[agent-server] failed to stop cleanly`, error)
        }) ?? Promise.resolve()
    }

    await stopping
    process.exit(exitCode)
  }

  try {
    const started = await runElectricAgentsEntrypoint()
    server = started.server

    console.log(`Electric Agents server running at ${started.url}`)
    console.log(
      `Durable Streams: ${started.options.durableStreamsUrl ?? `(embedded DurableStreamTestServer)`}`
    )
    console.log(`Postgres: ${started.options.postgresUrl}`)
    if (started.options.electricUrl) {
      console.log(`Electric: ${started.options.electricUrl}`)
    }
    console.log(`Working directory: ${started.options.workingDirectory}`)

    process.on(`SIGINT`, () => {
      void stop(0)
    })

    process.on(`SIGTERM`, () => {
      void stop(0)
    })

    process.on(`uncaughtException`, (error) => {
      console.error(error)
      void stop(1)
    })

    process.on(`unhandledRejection`, (error) => {
      console.error(error)
      void stop(1)
    })
  } catch (error) {
    console.error(error)
    if (server) {
      await server.stop().catch(() => {})
    }
    process.exit(1)
  }
}
