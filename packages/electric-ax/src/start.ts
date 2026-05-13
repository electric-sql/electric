import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { BuiltinAgentsServer } from '@electric-ax/agents'
import { appendPathToUrl } from '@electric-ax/agents-runtime'
import { readDotEnvFile, resolveAnthropicApiKey } from './env.js'
import {
  ELECTRIC_IMAGE_TAG,
  ELECTRIC_AGENTS_SERVER_IMAGE_TAG,
} from './version.js'
import type {
  StartCommandOptions,
  StartBuiltinCommandOptions,
  StopCommandOptions,
} from './index.js'

export { readDotEnvFile, resolveAnthropicApiKey } from './env.js'

const DEFAULT_ELECTRIC_AGENTS_PORT = 4437
const DEFAULT_COMPOSE_PROJECT_NAME = `electric-agents`
const DEFAULT_PULL_WAKE_RUNNER_ID = `builtin-agents`
const DEFAULT_PULL_WAKE_OWNER_ID = `builtin-agents`
const DEFAULT_PULL_WAKE_OWNER_NAME = `Built-in agents`
const DOCKER_COMPOSE_FILE = fileURLToPath(
  new URL(`../docker-compose.full.yml`, import.meta.url)
)

export interface StartedDevEnvironment {
  port: number
  uiUrl: string
  composeProjectName: string
}

export interface StoppedDevEnvironment {
  composeProjectName: string
  removedVolumes: boolean
}

export interface StartedBuiltinAgentsEnvironment {
  runnerId: string
  url: string
  agentServerUrl: string
}

interface WaitForServerOptions {
  fetchImpl?: typeof globalThis.fetch
  headers?: Record<string, string>
  timeoutMs?: number
  intervalMs?: number
}

export function resolveElectricAgentsPort(
  env: NodeJS.ProcessEnv = process.env,
  fileEnv: Record<string, string> = readDotEnvFile()
): number {
  const raw =
    env.ELECTRIC_AGENTS_PORT?.trim() || fileEnv.ELECTRIC_AGENTS_PORT?.trim()
  const parsed = raw ? Number(raw) : DEFAULT_ELECTRIC_AGENTS_PORT
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`ELECTRIC_AGENTS_PORT must be a positive integer`)
  }
  return parsed
}

export function getStartedEnvironmentMessage(
  started: StartedDevEnvironment
): string {
  return [
    `Electric Agents dev environment is up.`,
    `Server + UI: ${started.uiUrl}`,
    `Docker project: ${started.composeProjectName}`,
  ].join(`\n`)
}

export function getStoppedEnvironmentMessage(
  stopped: StoppedDevEnvironment
): string {
  return [
    `Electric Agents dev environment is down.`,
    `Docker project: ${stopped.composeProjectName}`,
    stopped.removedVolumes ? `Volumes removed: yes` : `Volumes removed: no`,
  ].join(`\n`)
}

export function getStartedBuiltinAgentsMessage(
  started: StartedBuiltinAgentsEnvironment
): string {
  return [
    `Builtin agents pull-wake runner is up.`,
    `Runner: ${started.runnerId}`,
    `Runtime: ${started.url}`,
    `Registers with: ${started.agentServerUrl}`,
    `Press Ctrl-C to stop.`,
  ].join(`\n`)
}

function readConfigValue(
  env: NodeJS.ProcessEnv,
  fileEnv: Record<string, string>,
  names: Array<string>
): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim() || fileEnv[name]?.trim()
    if (value) return value
  }
  return undefined
}

function runnerIdFromIdentity(identity: string | undefined): string {
  if (!identity) return DEFAULT_PULL_WAKE_RUNNER_ID
  const slug = identity
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, `-`)
    .replace(/^-+|-+$/g, ``)
  return slug ? `builtin-${slug}` : DEFAULT_PULL_WAKE_RUNNER_ID
}

export function resolvePullWakeRunnerId(
  env: NodeJS.ProcessEnv = process.env,
  fileEnv: Record<string, string> = readDotEnvFile()
): string {
  return (
    readConfigValue(env, fileEnv, [
      `ELECTRIC_AGENTS_PULL_WAKE_RUNNER_ID`,
      `PULL_WAKE_RUNNER_ID`,
    ]) ??
    runnerIdFromIdentity(
      readConfigValue(env, fileEnv, [
        `ELECTRIC_ASSERTED_AUTH_EMAIL`,
        `ELECTRIC_AGENTS_IDENTITY`,
      ])
    )
  )
}

export function resolvePullWakeOwnerId(
  env: NodeJS.ProcessEnv = process.env,
  fileEnv: Record<string, string> = readDotEnvFile()
): string {
  return (
    readConfigValue(env, fileEnv, [
      `ELECTRIC_ASSERTED_AUTH_EMAIL`,
      `ELECTRIC_AGENTS_IDENTITY`,
    ]) ?? DEFAULT_PULL_WAKE_OWNER_ID
  )
}

function buildAssertedAuthHeaders(
  env: NodeJS.ProcessEnv,
  fileEnv: Record<string, string>
): { headers: Record<string, string>; ownerUserId: string; name: string } {
  const email = resolvePullWakeOwnerId(env, fileEnv)
  const name =
    readConfigValue(env, fileEnv, [`ELECTRIC_ASSERTED_AUTH_NAME`]) ??
    DEFAULT_PULL_WAKE_OWNER_NAME
  const headers: Record<string, string> = {}
  headers[`X-Electric-Asserted-Email`] = email
  headers[`X-Electric-Asserted-Name`] = name
  return {
    headers,
    ownerUserId: email,
    name,
  }
}

function parseAdditionalServerHeaders(
  env: NodeJS.ProcessEnv,
  fileEnv: Record<string, string>
): Record<string, string> | undefined {
  const raw = readConfigValue(env, fileEnv, [`ELECTRIC_AGENTS_SERVER_HEADERS`])
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

export function resolveComposeProjectName(
  _cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): string {
  const explicit = env.ELECTRIC_AGENTS_COMPOSE_PROJECT?.trim()
  if (explicit) {
    return explicit
  }

  return DEFAULT_COMPOSE_PROJECT_NAME
}

async function runDockerCompose(
  args: Array<string>,
  env: NodeJS.ProcessEnv
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(`docker`, args, {
      cwd: process.cwd(),
      env,
      stdio: `inherit`,
    })

    child.on(`error`, (error) => {
      reject(
        new Error(
          `Failed to run docker compose: ${error instanceof Error ? error.message : String(error)}`
        )
      )
    })

    child.on(`exit`, (code) => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`docker compose exited with code ${code ?? `unknown`}`))
    })
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

export async function waitForElectricAgentsServer(
  baseUrl: string,
  options: WaitForServerOptions = {}
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 60_000
  const intervalMs = options.intervalMs ?? 1_000
  const deadline = Date.now() + timeoutMs
  const healthUrl = appendPathToUrl(baseUrl, `/_electric/health`)
  let lastError: string | null = null

  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(healthUrl, {
        headers: options.headers,
        signal: AbortSignal.timeout(5_000),
      })
      if (response.ok) {
        return
      }
      lastError = `healthcheck returned ${response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }

    await delay(intervalMs)
  }

  throw new Error(
    `Timed out waiting for Electric Agents server at ${healthUrl}${lastError ? `: ${lastError}` : ``}`
  )
}

export async function startElectricAgentsDevEnvironment(
  _options: StartCommandOptions = {},
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): Promise<StartedDevEnvironment> {
  const fileEnv = readDotEnvFile(cwd)
  const port = resolveElectricAgentsPort(env, fileEnv)
  const composeProjectName = resolveComposeProjectName(cwd, env)
  const assertedAuth = buildAssertedAuthHeaders(env, fileEnv)

  await runDockerCompose([`compose`, `-f`, DOCKER_COMPOSE_FILE, `up`, `-d`], {
    ...env,
    COMPOSE_PROJECT_NAME: composeProjectName,
    ELECTRIC_AGENTS_PORT: String(port),
    ELECTRIC_IMAGE_TAG: env.ELECTRIC_IMAGE_TAG ?? ELECTRIC_IMAGE_TAG,
    ELECTRIC_AGENTS_SERVER_IMAGE_TAG:
      env.ELECTRIC_AGENTS_SERVER_IMAGE_TAG ?? ELECTRIC_AGENTS_SERVER_IMAGE_TAG,
    ELECTRIC_AGENTS_DEV_ASSERTED_AUTH:
      env.ELECTRIC_AGENTS_DEV_ASSERTED_AUTH ??
      fileEnv.ELECTRIC_AGENTS_DEV_ASSERTED_AUTH ??
      `1`,
    ELECTRIC_ASSERTED_AUTH_EMAIL:
      env.ELECTRIC_ASSERTED_AUTH_EMAIL ??
      fileEnv.ELECTRIC_ASSERTED_AUTH_EMAIL ??
      assertedAuth.ownerUserId,
    ELECTRIC_ASSERTED_AUTH_NAME:
      env.ELECTRIC_ASSERTED_AUTH_NAME ??
      fileEnv.ELECTRIC_ASSERTED_AUTH_NAME ??
      assertedAuth.name,
  })

  const uiUrl = `http://localhost:${port}`
  await waitForElectricAgentsServer(uiUrl)

  return {
    port,
    uiUrl,
    composeProjectName,
  }
}

export async function stopElectricAgentsDevEnvironment(
  options: StopCommandOptions,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): Promise<StoppedDevEnvironment> {
  const composeProjectName = resolveComposeProjectName(cwd, env)
  const args = [`compose`, `-f`, DOCKER_COMPOSE_FILE, `down`]

  if (options.removeVolumes) {
    args.push(`--volumes`)
  }

  await runDockerCompose(args, {
    ...env,
    COMPOSE_PROJECT_NAME: composeProjectName,
  })

  return {
    composeProjectName,
    removedVolumes: options.removeVolumes ?? false,
  }
}

function waitForShutdown(
  stop: () => Promise<void>,
  signalSource: NodeJS.Process = process
): Promise<void> {
  return new Promise((resolve, reject) => {
    let stopping = false

    const cleanup = (): void => {
      signalSource.off(`SIGINT`, onSigint)
      signalSource.off(`SIGTERM`, onSigterm)
    }

    const shutdown = (signal: string): void => {
      if (stopping) {
        return
      }
      stopping = true
      cleanup()
      stop()
        .then(resolve)
        .catch((error) => {
          reject(
            new Error(
              `Failed to stop builtin agents server after ${signal}: ${error instanceof Error ? error.message : String(error)}`
            )
          )
        })
    }

    const onSigint = (): void => {
      shutdown(`SIGINT`)
    }
    const onSigterm = (): void => {
      shutdown(`SIGTERM`)
    }

    signalSource.on(`SIGINT`, onSigint)
    signalSource.on(`SIGTERM`, onSigterm)
  })
}

export async function startBuiltinAgentsServer(
  options: StartBuiltinCommandOptions,
  params: {
    env?: NodeJS.ProcessEnv
    cwd?: string
    agentServerUrl?: string
    printStartedMessage?: boolean
  } = {}
): Promise<StartedBuiltinAgentsEnvironment> {
  const env = params.env ?? process.env
  const cwd = params.cwd ?? process.cwd()
  const fileEnv = readDotEnvFile(cwd)
  const anthropicApiKey = resolveAnthropicApiKey(options, env, fileEnv)
  const runnerId = resolvePullWakeRunnerId(env, fileEnv)
  const assertedAuth = buildAssertedAuthHeaders(env, fileEnv)
  const serverHeaders = mergeHeaders(
    assertedAuth.headers,
    parseAdditionalServerHeaders(env, fileEnv)
  )
  const agentServerUrl =
    params.agentServerUrl ??
    env.ELECTRIC_AGENTS_URL?.trim() ??
    `http://localhost:${resolveElectricAgentsPort(env, fileEnv)}`

  process.env.ANTHROPIC_API_KEY = anthropicApiKey
  await waitForElectricAgentsServer(agentServerUrl, { headers: serverHeaders })

  const server = new BuiltinAgentsServer({
    agentServerUrl,
    workingDirectory: cwd,
    loadProjectMcpConfig: true,
    pullWake: {
      runnerId,
      ownerUserId: assertedAuth.ownerUserId,
      registerRunner: true,
      headers: serverHeaders,
      claimHeaders: serverHeaders,
      claimTokenHeader: hasHeader(serverHeaders, `authorization`)
        ? `electric-claim-token`
        : undefined,
    },
  })

  const url = await server.start()

  const started = {
    runnerId,
    url,
    agentServerUrl,
  }

  if (params.printStartedMessage ?? true) {
    console.log(getStartedBuiltinAgentsMessage(started))
  }
  await waitForShutdown(() => server.stop())
  return started
}
