import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb, runMigrations } from '../src/db'
import { wakeRegistrations } from '../src/db/schema'
import { WakeRegistry } from '../src/wake-registry'
import {
  ELECTRIC_AGENTS_COMPOSE_FILE,
  getElectricAgentsComposeProject,
  getElectricAgentsDevPorts,
} from './electric-agents-compose-utils'

const execFileAsync = promisify(execFile)
const { postgresPort, electricPort } = getElectricAgentsDevPorts()
const TEST_POSTGRES_PORT = postgresPort + 40
const TEST_ELECTRIC_PORT = electricPort + 40
const TEST_COMPOSE_PROJECT = `${getElectricAgentsComposeProject()}-wake-registry-sync`
const TEST_POSTGRES_URL = `postgres://electric_agents:electric_agents@localhost:${TEST_POSTGRES_PORT}/electric_agents`
const TEST_ELECTRIC_URL = `http://localhost:${TEST_ELECTRIC_PORT}`
const TEST_BACKEND_ENV = {
  ...process.env,
  ELECTRIC_AGENTS_COMPOSE_PROJECT: TEST_COMPOSE_PROJECT,
  PG_HOST_PORT: String(TEST_POSTGRES_PORT),
  ELECTRIC_HOST_PORT: String(TEST_ELECTRIC_PORT),
  JAEGER_UI_PORT: `0`,
  JAEGER_OTLP_HTTP_PORT: `0`,
  JAEGER_OTLP_GRPC_PORT: `0`,
  DATABASE_URL: TEST_POSTGRES_URL,
  ELECTRIC_URL: TEST_ELECTRIC_URL,
  ELECTRIC_AGENTS_TEST_BACKEND_MANAGED: `1`,
}

async function startTestBackend(): Promise<void> {
  await execFileAsync(
    `docker`,
    [
      `compose`,
      `-p`,
      TEST_COMPOSE_PROJECT,
      `-f`,
      ELECTRIC_AGENTS_COMPOSE_FILE,
      `up`,
      `-d`,
      `--wait`,
    ],
    { env: TEST_BACKEND_ENV }
  )
}

async function stopTestBackend(): Promise<void> {
  await execFileAsync(
    `docker`,
    [
      `compose`,
      `-p`,
      TEST_COMPOSE_PROJECT,
      `-f`,
      ELECTRIC_AGENTS_COMPOSE_FILE,
      `down`,
      `-v`,
    ],
    { env: TEST_BACKEND_ENV }
  )
}

async function resetTestBackend(): Promise<void> {
  await startTestBackend()
  const pg = postgres(TEST_POSTGRES_URL, { max: 1, onnotice: () => {} })
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
}

type DbConnection = ReturnType<typeof createDb>

let connection: DbConnection
let db: DbConnection[`db`]

describe(`WakeRegistry Electric collection sync`, () => {
  beforeAll(async () => {
    await resetTestBackend()
    connection = createDb(TEST_POSTGRES_URL)
    db = connection.db
  }, 120_000)

  afterAll(async () => {
    await Promise.allSettled([connection?.client.end(), stopTestBackend()])
  }, 120_000)

  it(`syncs wake rows from Postgres through Electric`, async () => {
    const suffix = randomUUID()
    const subscriberUrl = `/parent/sync-${suffix}`
    const sourceUrl = `/child/sync-${suffix}`
    const registry = new WakeRegistry(db as any)
    await registry.startSync(TEST_ELECTRIC_URL)

    const rows = await db
      .insert(wakeRegistrations)
      .values({
        subscriberUrl,
        sourceUrl,
        condition: `runFinished`,
        oneShot: false,
      })
      .returning()

    try {
      let results: Awaited<ReturnType<WakeRegistry[`evaluate`]>> = []
      const event = {
        type: `run`,
        key: `run-1`,
        value: { status: `completed` },
        headers: { operation: `update` },
      }
      const deadline = Date.now() + 15_000
      do {
        results = await registry.evaluate(sourceUrl, event)
        if (results.length > 0) break
        await new Promise((resolve) => setTimeout(resolve, 100))
      } while (Date.now() < deadline)

      expect(results).toHaveLength(1)
      expect(results[0]!.registrationDbId).toBe(rows[0]!.id)
    } finally {
      await registry.stopSync()
      await db
        .delete(wakeRegistrations)
        .where(eq(wakeRegistrations.sourceUrl, sourceUrl))
    }
  }, 25_000)
})
