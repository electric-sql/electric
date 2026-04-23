import { readFileSync } from 'node:fs'
import { basename, resolve as resolvePath } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { BuiltinAgentsServer } from '@electric-ax/agents'
import type {
  StartCommandOptions,
  StartBuiltinCommandOptions,
  StopCommandOptions,
} from './index.js'

const DEFAULT_ELECTRIC_AGENTS_PORT = 4437
const DEFAULT_BUILTIN_AGENTS_PORT = 4448
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
  port: number
  url: string
  registeredBaseUrl: string
  agentServerUrl: string
}

interface WaitForServerOptions {
  fetchImpl?: typeof globalThis.fetch
  timeoutMs?: number
  intervalMs?: number
}

function parseDotEnvValue(raw: string): string {
  const trimmed = raw.trim()
  if (
    (trimmed.startsWith(`"`) && trimmed.endsWith(`"`)) ||
    (trimmed.startsWith(`'`) && trimmed.endsWith(`'`))
  ) {
    return trimmed.slice(1, -1)
  }
  const hashIndex = trimmed.indexOf(`#`)
  return hashIndex === -1 ? trimmed : trimmed.slice(0, hashIndex).trim()
}

export function readDotEnvFile(
  cwd: string = process.cwd()
): Record<string, string> {
  const envPath = resolvePath(cwd, `.env`)

  try {
    const content = readFileSync(envPath, `utf8`)
    const values: Record<string, string> = {}

    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith(`#`)) {
        continue
      }

      const equalsIndex = trimmed.indexOf(`=`)
      if (equalsIndex <= 0) {
        continue
      }

      const key = trimmed.slice(0, equalsIndex).trim()
      const value = parseDotEnvValue(trimmed.slice(equalsIndex + 1))
      values[key] = value
    }

    return values
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === `ENOENT`) {
      return {}
    }
    throw error
  }
}

export function resolveAnthropicApiKey(
  options: StartBuiltinCommandOptions,
  env: NodeJS.ProcessEnv = process.env,
  fileEnv: Record<string, string> = readDotEnvFile()
): string {
  const candidate =
    options.anthropicApiKey?.trim() ||
    env.ANTHROPIC_API_KEY?.trim() ||
    fileEnv.ANTHROPIC_API_KEY?.trim()

  if (!candidate) {
    throw new Error(
      `ANTHROPIC_API_KEY is required. Pass --anthropic-api-key, export it in your shell, or set it in .env.`
    )
  }

  return candidate
}

export function resolveBuiltinAgentsPort(
  env: NodeJS.ProcessEnv = process.env,
  fileEnv: Record<string, string> = readDotEnvFile()
): number {
  const raw =
    env.ELECTRIC_AGENTS_BUILTIN_PORT?.trim() ||
    fileEnv.ELECTRIC_AGENTS_BUILTIN_PORT?.trim()
  const parsed = raw ? Number(raw) : DEFAULT_BUILTIN_AGENTS_PORT
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`ELECTRIC_AGENTS_BUILTIN_PORT must be a positive integer`)
  }
  return parsed
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
    `Builtin Horton server is up.`,
    `Webhook server: ${started.url}`,
    `Registers with: ${started.agentServerUrl}`,
    `Press Ctrl-C to stop.`,
  ].join(`\n`)
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, `-`)
    .replace(/^-+|-+$/g, ``)
}

export function resolveComposeProjectName(
  cwd: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env
): string {
  const explicit = env.ELECTRIC_AGENTS_COMPOSE_PROJECT?.trim()
  if (explicit) {
    return explicit
  }

  const base = slugify(basename(cwd)) || `workspace`
  return `electric-agents-${base}`
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
  const healthUrl = `${baseUrl.replace(/\/$/, ``)}/_electric/health`
  let lastError: string | null = null

  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(healthUrl, {
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

  await runDockerCompose([`compose`, `-f`, DOCKER_COMPOSE_FILE, `up`, `-d`], {
    ...env,
    COMPOSE_PROJECT_NAME: composeProjectName,
    ELECTRIC_AGENTS_PORT: String(port),
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
  } = {}
): Promise<StartedBuiltinAgentsEnvironment> {
  const env = params.env ?? process.env
  const cwd = params.cwd ?? process.cwd()
  const fileEnv = readDotEnvFile(cwd)
  const anthropicApiKey = resolveAnthropicApiKey(options, env, fileEnv)
  const port = resolveBuiltinAgentsPort(env, fileEnv)
  const agentServerUrl =
    params.agentServerUrl ??
    env.ELECTRIC_AGENTS_URL?.trim() ??
    `http://localhost:${resolveElectricAgentsPort(env, fileEnv)}`

  process.env.ANTHROPIC_API_KEY = anthropicApiKey
  await waitForElectricAgentsServer(agentServerUrl)

  const server = new BuiltinAgentsServer({
    agentServerUrl,
    port,
    workingDirectory: cwd,
  })

  await server.start()

  const started = {
    port,
    url: server.url,
    registeredBaseUrl: server.registeredBaseUrl,
    agentServerUrl,
  }

  console.log(getStartedBuiltinAgentsMessage(started))
  await waitForShutdown(() => server.stop())
  return started
}
