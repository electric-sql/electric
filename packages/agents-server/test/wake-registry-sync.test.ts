import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDb } from '../src/db'
import { wakeRegistrations } from '../src/db/schema'
import { WakeRegistry } from '../src/wake-registry'
import {
  TEST_ELECTRIC_URL,
  TEST_POSTGRES_URL,
  resetElectricAgentsTestBackend,
} from './test-backend'

const connection = createDb(TEST_POSTGRES_URL)
const db = connection.db

describe(`WakeRegistry Electric collection sync`, () => {
  beforeAll(async () => {
    await resetElectricAgentsTestBackend()
  })

  afterAll(async () => {
    await connection.client.end()
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
    await registry.startSync(TEST_ELECTRIC_URL)

    try {
      const results = await registry.evaluate(sourceUrl, {
        type: `run`,
        key: `run-1`,
        value: { status: `completed` },
        headers: { operation: `update` },
      })

      expect(results).toHaveLength(1)
      expect(results[0]!.registrationDbId).toBe(rows[0]!.id)
    } finally {
      await registry.stopSync()
      await db
        .delete(wakeRegistrations)
        .where(eq(wakeRegistrations.sourceUrl, sourceUrl))
    }
  })
})
