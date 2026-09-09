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

describe(`PostgresRegistry claim fencing and post-done status`, () => {
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

  async function createEntity(
    url: string,
    status: `idle` | `running` | `stopping`
  ) {
    const now = Date.now()
    await registry.createEntity({
      url,
      type: `test`,
      status,
      streams: { main: `${url}/main` },
      subscription_id: `sub-${url}`,
      write_token: `wt-${url}`,
      tags: {},
      created_at: now,
      updated_at: now,
    })
  }

  it(`refuses to replace an active claim with unlessActive, and allows it again once released`, async () => {
    const claim = {
      consumerId: `wake-dup`,
      epoch: 3,
      entityUrl: `/horton/dup`,
      streamPath: `/horton/dup/main`,
      unlessActive: true,
    }
    const firstClaimedAt = new Date(`2026-05-19T10:00:00Z`)

    expect(
      await registry.materializeActiveClaim({
        ...claim,
        claimedAt: firstClaimedAt,
      })
    ).toBe(true)
    // The redelivered wake's second claim: same (consumerId, epoch), row
    // still active.
    expect(
      await registry.materializeActiveClaim({
        ...claim,
        claimedAt: new Date(`2026-05-19T10:00:05Z`),
      })
    ).toBe(false)
    const rows = await db
      .select()
      .from(consumerClaims)
      .where(
        and(
          eq(consumerClaims.consumerId, `wake-dup`),
          eq(consumerClaims.epoch, 3)
        )
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]!.claimedAt).toEqual(firstClaimedAt)

    await registry.materializeReleasedClaim({
      consumerId: `wake-dup`,
      epoch: 3,
    })
    expect(await registry.materializeActiveClaim(claim)).toBe(true)
  })

  it(`replaces an active claim without unlessActive (pull-wake reclaim)`, async () => {
    const claim = {
      consumerId: `wake-reclaim`,
      epoch: 1,
      entityUrl: `/horton/reclaim`,
      streamPath: `/horton/reclaim/main`,
    }
    expect(await registry.materializeActiveClaim(claim)).toBe(true)
    expect(
      await registry.materializeActiveClaim({ ...claim, runnerId: `runner-2` })
    ).toBe(true)
  })

  it(`settles running to idle and stopping to stopped after done, and leaves other statuses alone`, async () => {
    await createEntity(`/horton/running`, `running`)
    await createEntity(`/horton/stopping`, `stopping`)
    await createEntity(`/horton/idle`, `idle`)

    expect(await registry.updateStatusAfterDone(`/horton/running`)).toBe(`idle`)
    expect(await registry.updateStatusAfterDone(`/horton/stopping`)).toBe(
      `stopped`
    )
    // A done that raced the next wake's delivery finds the entity idle only
    // between wakes; a status the done did not cause is not overwritten.
    expect(await registry.updateStatusAfterDone(`/horton/idle`)).toBeNull()

    expect((await registry.getEntity(`/horton/running`))?.status).toBe(`idle`)
    expect((await registry.getEntity(`/horton/stopping`))?.status).toBe(
      `stopped`
    )
    expect((await registry.getEntity(`/horton/idle`))?.status).toBe(`idle`)
  })

  it(`reverts only a running entity when the runtime refuses the wake`, async () => {
    await createEntity(`/horton/refused`, `running`)
    await createEntity(`/horton/refused-stopping`, `stopping`)

    expect(await registry.revertRunningStatus(`/horton/refused`)).toBe(true)
    // A wake refused while the entity is stopping (a rolling runtime restart
    // refuses every wake it is handed) must not report the entity idle.
    expect(await registry.revertRunningStatus(`/horton/refused-stopping`)).toBe(
      false
    )

    expect((await registry.getEntity(`/horton/refused`))?.status).toBe(`idle`)
    expect((await registry.getEntity(`/horton/refused-stopping`))?.status).toBe(
      `stopping`
    )
  })
})
