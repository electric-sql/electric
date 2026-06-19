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

  it(`syncs a registered wake through Postgres and Electric`, async () => {
    const registry = new WakeRegistry(db as any)
    await registry.startSync(TEST_ELECTRIC_URL)

    await registry.register({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/child/c1`,
      condition: `runFinished`,
      oneShot: false,
    })

    const rows = await db
      .select()
      .from(wakeRegistrations)
      .where(eq(wakeRegistrations.sourceUrl, `/child/c1`))

    expect(rows).toHaveLength(1)

    const results = await registry.evaluate(`/child/c1`, {
      type: `run`,
      key: `run-1`,
      value: { status: `completed` },
      headers: { operation: `update` },
    })

    expect(results).toHaveLength(1)
    expect(results[0]!.registrationDbId).toBe(rows[0]!.id)

    await registry.stopSync()
  })
})
