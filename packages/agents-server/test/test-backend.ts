import './setup-test-backend-env'
import { execFile } from 'node:child_process'
import { mkdir, rmdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import postgres from 'postgres'
import { runMigrations } from '../src/db/index'
import {
  ELECTRIC_AGENTS_COMPOSE_FILE,
  getElectricAgentsComposeProject,
} from './electric-agents-compose-utils'

const execFileAsync = promisify(execFile)

export const TEST_POSTGRES_URL =
  process.env.DATABASE_URL ??
  `postgres://electric_agents:electric_agents@localhost:5432/electric_agents`
export const TEST_ELECTRIC_URL =
  process.env.ELECTRIC_URL ?? `http://localhost:3060`

const hasExplicitBackendConfig =
  process.env.ELECTRIC_AGENTS_TEST_BACKEND_MANAGED !== `1` &&
  (process.env.DATABASE_URL !== undefined ||
    process.env.ELECTRIC_URL !== undefined ||
    process.env.CLICKHOUSE_URL !== undefined)

let ensureBackendPromise: Promise<void> | null = null
const resetLockDir = path.join(
  os.tmpdir(),
  `${getElectricAgentsComposeProject()}-agent-server-test-backend.lock`
)

async function startElectricAgentsTestBackend(): Promise<void> {
  await execFileAsync(
    `docker`,
    [
      `compose`,
      `-p`,
      getElectricAgentsComposeProject(),
      `-f`,
      ELECTRIC_AGENTS_COMPOSE_FILE,
      `up`,
      `-d`,
      `--wait`,
    ],
    {
      env: process.env,
    }
  )
}

async function stopElectricAgentsTestBackendAndRemoveVolumes(): Promise<void> {
  await execFileAsync(
    `docker`,
    [
      `compose`,
      `-p`,
      getElectricAgentsComposeProject(),
      `-f`,
      ELECTRIC_AGENTS_COMPOSE_FILE,
      `down`,
      `-v`,
    ],
    {
      env: process.env,
    }
  )
}

async function hasColumn(
  postgresUrl: string,
  tableName: string,
  columnName: string
): Promise<boolean> {
  const pg = postgres(postgresUrl, {
    max: 1,
    onnotice: () => {},
  })

  try {
    const rows = (await pg`
      select exists (
        select 1
        from information_schema.columns
        where table_schema = 'public'
          and table_name = ${tableName}
          and column_name = ${columnName}
      ) as "exists"
    `) as Array<{ exists: boolean }>
    return rows[0]?.exists === true
  } finally {
    await pg.end({ timeout: 2 })
  }
}

async function hasTable(
  postgresUrl: string,
  tableName: string
): Promise<boolean> {
  const pg = postgres(postgresUrl, {
    max: 1,
    onnotice: () => {},
  })

  try {
    const rows = (await pg`
      select exists (
        select 1
        from information_schema.tables
        where table_schema = 'public'
          and table_name = ${tableName}
      ) as "exists"
    `) as Array<{ exists: boolean }>
    return rows[0]?.exists === true
  } finally {
    await pg.end({ timeout: 2 })
  }
}

async function ensureExpectedSchema(postgresUrl: string): Promise<void> {
  const matchesCurrentSchema = async (): Promise<boolean> => {
    const [
      hasEntitiesTags,
      hasEntitiesTagsIndex,
      hasOutboxDeadLetteredAt,
      hasEntityManifestSources,
      hasLegacyEntitiesMetadata,
    ] = await Promise.all([
      hasColumn(postgresUrl, `entities`, `tags`),
      hasColumn(postgresUrl, `entities`, `tags_index`),
      hasColumn(postgresUrl, `tag_stream_outbox`, `dead_lettered_at`),
      hasTable(postgresUrl, `entity_manifest_sources`),
      hasColumn(postgresUrl, `entities`, `metadata`),
    ])

    return (
      hasEntitiesTags &&
      hasEntitiesTagsIndex &&
      hasOutboxDeadLetteredAt &&
      hasEntityManifestSources &&
      !hasLegacyEntitiesMetadata
    )
  }

  if (await matchesCurrentSchema()) {
    return
  }

  if (process.env.ELECTRIC_AGENTS_TEST_BACKEND_MANAGED === `1`) {
    await stopElectricAgentsTestBackendAndRemoveVolumes()
    ensureBackendPromise = null
    await ensureElectricAgentsTestBackend()
    await runMigrations(postgresUrl)
    if (await matchesCurrentSchema()) {
      return
    }
  }

  const composeProject = getElectricAgentsComposeProject()
  const pgHostPort = process.env.PG_HOST_PORT ?? `5432`
  const electricHostPort = process.env.ELECTRIC_HOST_PORT ?? `3060`
  throw new Error(
    `ElectricAgents test backend schema is stale: expected current tags/manifest/outbox schema and no legacy entities.metadata column. Reset the matching backend with "ELECTRIC_AGENTS_COMPOSE_PROJECT=${composeProject} PG_HOST_PORT=${pgHostPort} ELECTRIC_HOST_PORT=${electricHostPort} pnpm clean:electric-agents" and rerun the relevant Vitest project.`
  )
}
export async function ensureElectricAgentsTestBackend(): Promise<void> {
  if (ensureBackendPromise) {
    await ensureBackendPromise
    return
  }

  ensureBackendPromise = (async () => {
    try {
      const pg = postgres(TEST_POSTGRES_URL, {
        max: 1,
        onnotice: () => {},
        connect_timeout: 2,
      })

      try {
        await pg`select 1`
      } finally {
        await pg.end({ timeout: 2 })
      }
    } catch (error) {
      if (hasExplicitBackendConfig) {
        const details = error instanceof Error ? error.message : String(error)
        throw new Error(
          `Explicit Electric Agents test backend is unreachable at ${TEST_POSTGRES_URL}: ${details}`
        )
      }
      await startElectricAgentsTestBackend()
    }
  })()

  try {
    await ensureBackendPromise
  } catch (error) {
    ensureBackendPromise = null
    throw error
  }
}

export async function resetElectricAgentsTestBackend(): Promise<void> {
  await ensureElectricAgentsTestBackend()

  await withResetLock(async () => {
    const pg = postgres(TEST_POSTGRES_URL, {
      max: 1,
      onnotice: () => {},
    })

    try {
      await pg.unsafe(`
        DROP SCHEMA IF EXISTS drizzle CASCADE;
        DROP SCHEMA IF EXISTS public CASCADE;
        CREATE SCHEMA public AUTHORIZATION CURRENT_USER;
      `)
    } finally {
      await pg.end()
    }

    await runMigrations(TEST_POSTGRES_URL)
    await ensureExpectedSchema(TEST_POSTGRES_URL)
  })
}

async function withResetLock<T>(fn: () => Promise<T>): Promise<T> {
  for (;;) {
    try {
      await mkdir(resetLockDir)
      break
    } catch (error) {
      if (
        typeof error === `object` &&
        error !== null &&
        `code` in error &&
        error.code === `EEXIST`
      ) {
        await new Promise((resolve) => setTimeout(resolve, 100))
        continue
      }
      throw error
    }
  }

  try {
    return await fn()
  } finally {
    await rmdir(resetLockDir).catch(() => {})
  }
}
