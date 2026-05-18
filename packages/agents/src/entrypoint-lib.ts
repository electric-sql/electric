import { BuiltinAgentsServer } from './server.js'
import { mergeElectricPrincipalHeader } from '@electric-ax/agents-runtime'
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

function parseAdditionalServerHeaders(
  env: EnvSource
): Record<string, string> | undefined {
  const raw = readEnv(env, [`ELECTRIC_AGENTS_SERVER_HEADERS`])
  if (!raw) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`Invalid ELECTRIC_AGENTS_SERVER_HEADERS: expected JSON`)
  }
  if (!parsed || typeof parsed !== `object` || Array.isArray(parsed)) {
    throw new Error(
      `Invalid ELECTRIC_AGENTS_SERVER_HEADERS: expected a JSON object`
    )
  }
  const headers = new Headers()
  for (const [name, value] of Object.entries(
    parsed as Record<string, unknown>
  )) {
    if (typeof value !== `string`) {
      throw new Error(
        `Invalid ELECTRIC_AGENTS_SERVER_HEADERS: header "${name}" must be a string`
      )
    }
    headers.set(name, value)
  }
  const normalized = Object.fromEntries(headers.entries())
  return Object.keys(normalized).length > 0 ? normalized : undefined
}

function mergeHeaders(
  ...sources: Array<Record<string, string> | undefined>
): Record<string, string> | undefined {
  const headers = new Headers()
  for (const source of sources) {
    if (!source) continue
    new Headers(source).forEach((value, key) => headers.set(key, value))
  }
  const merged = Object.fromEntries(headers.entries())
  return Object.keys(merged).length > 0 ? merged : undefined
}

function hasHeader(
  headers: Record<string, string> | undefined,
  name: string
): boolean {
  return headers ? new Headers(headers).has(name) : false
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

  const serverHeaders = mergeHeaders(
    mergeElectricPrincipalHeader(
      parseAdditionalServerHeaders(env),
      readEnv(env, [`ELECTRIC_AGENTS_PRINCIPAL`])
    )
  )

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
      headers: serverHeaders,
      claimHeaders: serverHeaders,
      claimTokenHeader: hasHeader(serverHeaders, `authorization`)
        ? `electric-claim-token`
        : undefined,
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
