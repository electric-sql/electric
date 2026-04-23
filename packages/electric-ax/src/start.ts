import { readFileSync } from 'node:fs'
import { basename, resolve as resolvePath } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { StartCommandOptions, StopCommandOptions } from './index.js'

const DEFAULT_ELECTRIC_AGENTS_PORT = 4437
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
  options: StartCommandOptions,
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

export async function startElectricAgentsDevEnvironment(
  options: StartCommandOptions,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd()
): Promise<StartedDevEnvironment> {
  const fileEnv = readDotEnvFile(cwd)
  const anthropicApiKey = resolveAnthropicApiKey(options, env, fileEnv)
  const port = resolveElectricAgentsPort(env, fileEnv)
  const composeProjectName = resolveComposeProjectName(cwd, env)

  await runDockerCompose([`compose`, `-f`, DOCKER_COMPOSE_FILE, `up`, `-d`], {
    ...env,
    ANTHROPIC_API_KEY: anthropicApiKey,
    COMPOSE_PROJECT_NAME: composeProjectName,
    ELECTRIC_AGENTS_PORT: String(port),
  })

  return {
    port,
    uiUrl: `http://localhost:${port}`,
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
