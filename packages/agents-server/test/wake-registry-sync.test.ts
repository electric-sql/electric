import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb } from '../src/db'
import { wakeRegistrations } from '../src/db/schema'
import { WakeRegistry } from '../src/wake-registry'
import { configureElectricAgentsTestBackendEnv } from './test-backend-env'
import type { createDb as createDbType } from '../src/db'

configureElectricAgentsTestBackendEnv(`agent-server-sync`, 10)

type DbConnection = ReturnType<typeof createDbType>

let connection: DbConnection
let db: DbConnection[`db`]
let testElectricUrl: string

describe(`WakeRegistry Electric collection sync`, () => {
  beforeAll(async () => {
    const backend = await import(`./test-backend`)
    await backend.resetElectricAgentsTestBackend()
    testElectricUrl = backend.TEST_ELECTRIC_URL
    connection = createDb(backend.TEST_POSTGRES_URL)
    db = connection.db
  }, 60_000)

  afterAll(async () => {
    await connection?.client.end()
  })

  it(`syncs wake rows from Postgres through Electric`, async () => {
    const suffix = randomUUID()
    const subscriberUrl = `/parent/sync-${suffix}`
    const sourceUrl = `/child/sync-${suffix}`
    const rows = await db
      .insert(wakeRegistrations)
      .values({
        subscriberUrl,
        sourceUrl,
        condition: `runFinished`,
        oneShot: false,
      })
      .returning()

    const registry = new WakeRegistry(db as any)
    await registry.startSync(testElectricUrl)

    try {
      let results: Awaited<ReturnType<WakeRegistry[`evaluate`]>> = []
      const event = {
        type: `run`,
        key: `run-1`,
        value: { status: `completed` },
        headers: { operation: `update` },
      }
      const deadline = Date.now() + 5_000
      do {
        results = await registry.evaluate(sourceUrl, event)
        if (results.length > 0) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      } while (Date.now() < deadline)

      expect(results).toHaveLength(1)
      expect(results[0]!.registrationDbId).toBe(rows[0]!.id)
    } finally {
      await registry.stopSync()
      await db
        .delete(wakeRegistrations)
        .where(eq(wakeRegistrations.sourceUrl, sourceUrl))
    }
  }, 15_000)
})
