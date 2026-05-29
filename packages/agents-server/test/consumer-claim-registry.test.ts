import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '../src/db/index'
import { consumerClaims } from '../src/db/schema'
import { PostgresRegistry } from '../src/entity-registry'
import {
  TEST_POSTGRES_URL,
  resetElectricAgentsTestBackend,
} from './test-backend'

describe(`PostgresRegistry consumer-claim heartbeat (regression for #4341)`, () => {
  let registry: PostgresRegistry
  let db: ReturnType<typeof createDb>[`db`]
  let client: ReturnType<typeof createDb>[`client`]

  beforeAll(async () => {
    await resetElectricAgentsTestBackend()
    const connection = createDb(TEST_POSTGRES_URL)
    db = connection.db
    client = connection.client
    registry = new PostgresRegistry(db)
  }, 120_000)

  beforeEach(async () => {
    await resetElectricAgentsTestBackend()
  }, 120_000)

  afterAll(async () => {
    await client?.end()
  }, 120_000)

  async function readLease(
    consumerId: string,
    epoch: number
  ): Promise<Date | null> {
    const rows = await db
      .select()
      .from(consumerClaims)
      .where(
        and(
          eq(consumerClaims.consumerId, consumerId),
          eq(consumerClaims.epoch, epoch)
        )
      )
      .limit(1)
    return rows[0]?.leaseExpiresAt ?? null
  }

  it(`preserves lease_expires_at when heartbeat is called without one`, async () => {
    const claimedAt = new Date(`2026-05-19T10:00:00Z`)
    const lease = new Date(`2026-05-19T10:00:30Z`)
    await registry.materializeActiveClaim({
      consumerId: `wake-preserve`,
      epoch: 1,
      entityUrl: `/horton/preserve`,
      streamPath: `/horton/preserve/main`,
      claimedAt,
      leaseExpiresAt: lease,
    })

    expect(await readLease(`wake-preserve`, 1)).toEqual(lease)

    // Heartbeat with no leaseExpiresAt — must not null the column.
    await registry.materializeHeartbeatClaim({
      consumerId: `wake-preserve`,
      epoch: 1,
      heartbeatAt: new Date(`2026-05-19T10:00:10Z`),
    })

    expect(await readLease(`wake-preserve`, 1)).toEqual(lease)
  })

  it(`updates lease_expires_at when heartbeat explicitly provides one`, async () => {
    const claimedAt = new Date(`2026-05-19T10:00:00Z`)
    const initialLease = new Date(`2026-05-19T10:00:30Z`)
    const extendedLease = new Date(`2026-05-19T10:01:00Z`)
    await registry.materializeActiveClaim({
      consumerId: `wake-extend`,
      epoch: 1,
      entityUrl: `/horton/extend`,
      streamPath: `/horton/extend/main`,
      claimedAt,
      leaseExpiresAt: initialLease,
    })

    expect(await readLease(`wake-extend`, 1)).toEqual(initialLease)

    await registry.materializeHeartbeatClaim({
      consumerId: `wake-extend`,
      epoch: 1,
      heartbeatAt: new Date(`2026-05-19T10:00:20Z`),
      leaseExpiresAt: extendedLease,
    })

    expect(await readLease(`wake-extend`, 1)).toEqual(extendedLease)
  })
})
