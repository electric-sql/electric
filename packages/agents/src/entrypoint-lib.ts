import { BuiltinAgentsServer } from './server.js'
import type { BuiltinAgentsServerOptions } from './server.js'

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

function validateUrl(name: string, value: string): string {
  try {
    new URL(value)
    return value
  } catch {
    throw new Error(`Invalid ${name}: "${value}"`)
  }
}

function buildAssertedAuthHeaders(
  env: EnvSource
): Record<string, string> | undefined {
  const headers: Record<string, string> = {}
  const email = readEnv(env, [`ELECTRIC_ASSERTED_AUTH_EMAIL`])
  const name = readEnv(env, [`ELECTRIC_ASSERTED_AUTH_NAME`])

  if (email) {
    headers[`X-Electric-Asserted-Email`] = email
  }
  if (name) {
    headers[`X-Electric-Asserted-Name`] = name
  }

  return Object.keys(headers).length > 0 ? headers : undefined
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
  const runnerId = readRequiredEnv(
    env,
    [`ELECTRIC_AGENTS_PULL_WAKE_RUNNER_ID`, `PULL_WAKE_RUNNER_ID`],
    `pull-wake runner id`
  )

  const assertedAuthHeaders = buildAssertedAuthHeaders(env)

  return {
    agentServerUrl,
    workingDirectory:
      readEnv(env, [
        `ELECTRIC_AGENTS_WORKING_DIRECTORY`,
        `WORKING_DIRECTORY`,
      ]) ?? cwd,
    pullWake: {
      runnerId,
      registerRunner:
        readEnv(env, [`ELECTRIC_AGENTS_REGISTER_PULL_WAKE_RUNNER`]) ===
          `true` ||
        readEnv(env, [`ELECTRIC_AGENTS_REGISTER_PULL_WAKE_RUNNER`]) === `1`,
      headers: assertedAuthHeaders,
      claimHeaders: assertedAuthHeaders,
    },
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

    console.log(`Builtin agents pull-wake runner started at ${started.url}`)
    console.log(`Registering against: ${started.options.agentServerUrl}`)
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
