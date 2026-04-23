import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url))

export const ELECTRIC_AGENTS_COMPOSE_FILE = path.resolve(
  TEST_DIR,
  `../docker-compose.dev.yml`
)

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, `-`)
    .replace(/^-+|-+$/g, ``)
}

function getWorktreeRoot(cwd: string = process.cwd()): string {
  try {
    const gitRoot = execSync(`git rev-parse --show-toplevel`, {
      cwd,
      encoding: `utf8`,
      stdio: [`ignore`, `pipe`, `ignore`],
    }).trim()
    return realpathSync(gitRoot)
  } catch {
    return realpathSync(cwd)
  }
}

function getWorktreeHash(cwd: string = process.cwd()): string {
  return createHash(`sha256`).update(getWorktreeRoot(cwd)).digest(`hex`)
}

function getStablePort(
  seed: string,
  envName: string,
  base: number,
  span: number
): number {
  const override = process.env[envName]?.trim()
  if (override) {
    const port = Number.parseInt(override, 10)
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`Invalid ${envName} port: ${override}`)
    }
    return port
  }

  const hash = createHash(`sha256`).update(seed).digest()
  const offset = hash.readUInt16BE(0) % span
  return base + offset
}

export function getElectricAgentsComposeProject(
  cwd: string = process.cwd()
): string {
  const override = process.env.ELECTRIC_AGENTS_COMPOSE_PROJECT?.trim()
  if (override) {
    return slugify(override)
  }

  const worktreeRoot = getWorktreeRoot(cwd)
  const repoName = slugify(path.basename(worktreeRoot)) || `electric-agents`
  const worktreeHash = getWorktreeHash(cwd).slice(0, 8)

  return `electric-agents-${repoName}-${worktreeHash}`
}

export function getElectricAgentsDevPorts(cwd: string = process.cwd()): {
  electricAgentsPort: number
  postgresPort: number
  electricPort: number
  jaegerUiPort: number
  jaegerOtlpHttpPort: number
  jaegerOtlpGrpcPort: number
} {
  const seed = getWorktreeHash(cwd)

  return {
    electricAgentsPort: getStablePort(
      `${seed}:electric-agents`,
      `ELECTRIC_AGENTS_PORT`,
      4400,
      600
    ),
    postgresPort: getStablePort(`${seed}:postgres`, `PG_HOST_PORT`, 55000, 700),
    electricPort: getStablePort(
      `${seed}:electric`,
      `ELECTRIC_HOST_PORT`,
      56400,
      700
    ),
    jaegerUiPort: getStablePort(
      `${seed}:jaeger-ui`,
      `JAEGER_UI_PORT`,
      57100,
      700
    ),
    jaegerOtlpHttpPort: getStablePort(
      `${seed}:jaeger-otlp-http`,
      `JAEGER_OTLP_HTTP_PORT`,
      57800,
      700
    ),
    jaegerOtlpGrpcPort: getStablePort(
      `${seed}:jaeger-otlp-grpc`,
      `JAEGER_OTLP_GRPC_PORT`,
      58500,
      700
    ),
  }
}
