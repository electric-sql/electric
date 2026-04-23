import { BuiltinAgentsServer } from './server.js'
import type { BuiltinAgentsServerOptions } from './server.js'

const DEFAULT_HOST = `127.0.0.1`
const DEFAULT_PORT = 4448

type EnvSource = Record<string, string | undefined>

export interface BuiltinAgentsEntrypointOptions
  extends BuiltinAgentsServerOptions {}

export interface BuiltinAgentsEntrypointServer {
  start: () => Promise<string>
  stop: () => Promise<void>
}

export interface RunBuiltinAgentsEntrypointOptions {
  env?: EnvSource
  cwd?: string
  createServer?: (
    options: BuiltinAgentsEntrypointOptions
  ) => BuiltinAgentsEntrypointServer
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
  const raw = readEnv(env, [`ELECTRIC_AGENTS_BUILTIN_PORT`, `PORT`])
  if (!raw) {
    return DEFAULT_PORT
  }

  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(
      `Invalid builtin agents port "${raw}". Expected an integer between 1 and 65535.`
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

export function resolveBuiltinAgentsEntrypointOptions(
  env: EnvSource = process.env,
  cwd = process.cwd()
): BuiltinAgentsEntrypointOptions {
  const agentServerUrl = validateUrl(
    `agent server URL`,
    readRequiredEnv(
      env,
      [`ELECTRIC_AGENTS_SERVER_URL`, `ELECTRIC_AGENTS_BASE_URL`],
      `agent server base URL`
    )
  )
  const baseUrl = readEnv(env, [
    `ELECTRIC_AGENTS_BUILTIN_BASE_URL`,
    `BUILTIN_AGENTS_BASE_URL`,
  ])

  return {
    agentServerUrl,
    baseUrl: baseUrl
      ? validateUrl(`builtin agents base URL`, baseUrl)
      : undefined,
    host:
      readEnv(env, [`ELECTRIC_AGENTS_BUILTIN_HOST`, `HOST`]) ?? DEFAULT_HOST,
    port: readPort(env),
    workingDirectory:
      readEnv(env, [
        `ELECTRIC_AGENTS_WORKING_DIRECTORY`,
        `WORKING_DIRECTORY`,
      ]) ?? cwd,
  }
}

export async function runBuiltinAgentsEntrypoint({
  env = process.env,
  cwd = process.cwd(),
  createServer = (options) => new BuiltinAgentsServer(options),
}: RunBuiltinAgentsEntrypointOptions = {}): Promise<{
  options: BuiltinAgentsEntrypointOptions
  server: BuiltinAgentsEntrypointServer
  url: string
}> {
  const options = resolveBuiltinAgentsEntrypointOptions(env, cwd)
  const server = createServer(options)
  const url = await server.start()

  return { options, server, url }
}

export async function main(): Promise<void> {
  try {
    process.loadEnvFile()
  } catch {}

  let server: BuiltinAgentsEntrypointServer | null = null
  let stopping: Promise<void> | null = null

  const stop = async (exitCode: number): Promise<never> => {
    if (!stopping) {
      stopping =
        server?.stop().catch((error) => {
          console.error(`[builtin-agents] failed to stop cleanly`, error)
        }) ?? Promise.resolve()
    }

    await stopping
    process.exit(exitCode)
  }

  try {
    const started = await runBuiltinAgentsEntrypoint()
    server = started.server

    console.log(`Builtin agents server running at ${started.url}`)
    console.log(`Registering against: ${started.options.agentServerUrl}`)
    console.log(`Working directory: ${started.options.workingDirectory}`)
    if (started.options.baseUrl) {
      console.log(`Public webhook base URL: ${started.options.baseUrl}`)
    }

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
