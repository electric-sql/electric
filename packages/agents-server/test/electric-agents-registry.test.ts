import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { PostgresRegistry } from '../src/electric-agents-registry'
import type { createDb } from '../src/db/index'
import {
  recoveryItemFromExpiredDispatchStateRow,
  recoveryItemFromStaleOutstandingWakeRow,
  subtractAckedSourceStreamsFromPending,
} from '../src/electric-agents-registry'

describe(`recoveryItemFromExpiredDispatchStateRow`, () => {
  it(`returns a follow-up dispatch item when pending streams remain`, () => {
    expect(
      recoveryItemFromExpiredDispatchStateRow({
        entityUrl: `/chat/recovered`,
        pendingSourceStreams: [{ path: `/chat/recovered/main`, offset: `9` }],
        pendingReason: `message`,
      })
    ).toEqual({
      entityUrl: `/chat/recovered`,
      pendingSourceStreams: [{ path: `/chat/recovered/main`, offset: `9` }],
      pendingReason: `message`,
    })
  })

  it(`returns null when no pending streams remain`, () => {
    expect(
      recoveryItemFromExpiredDispatchStateRow({
        entityUrl: `/chat/recovered`,
        pendingSourceStreams: [],
        pendingReason: `message`,
      })
    ).toBeNull()
  })
})

describe(`recoveryItemFromStaleOutstandingWakeRow`, () => {
  it(`returns a follow-up dispatch item with the stale wake id when pending streams remain`, () => {
    expect(
      recoveryItemFromStaleOutstandingWakeRow({
        entityUrl: `/chat/recovered`,
        wakeId: `wake-1`,
        pendingSourceStreams: [{ path: `/chat/recovered/main`, offset: `11` }],
        pendingReason: `message`,
      })
    ).toEqual({
      entityUrl: `/chat/recovered`,
      wakeId: `wake-1`,
      pendingSourceStreams: [{ path: `/chat/recovered/main`, offset: `11` }],
      pendingReason: `message`,
    })
  })

  it(`returns null without a wake id or pending streams`, () => {
    expect(
      recoveryItemFromStaleOutstandingWakeRow({
        entityUrl: `/chat/recovered`,
        wakeId: null,
        pendingSourceStreams: [{ path: `/chat/recovered/main`, offset: `11` }],
      })
    ).toBeNull()

    expect(
      recoveryItemFromStaleOutstandingWakeRow({
        entityUrl: `/chat/recovered`,
        wakeId: `wake-1`,
        pendingSourceStreams: [],
      })
    ).toBeNull()
  })
})

describe(`subtractAckedSourceStreamsFromPending`, () => {
  it(`removes pending streams whose offsets are covered by acknowledgements`, () => {
    expect(
      subtractAckedSourceStreamsFromPending(
        [
          { path: `/chat/one/main`, offset: `7` },
          { path: `/chat/two/main`, offset: `10` },
          { path: `/chat/three/main`, offset: `4` },
        ],
        [
          { path: `/chat/one/main`, offset: `7` },
          { path: `/chat/two/main`, offset: `9` },
        ]
      )
    ).toEqual([
      { path: `/chat/two/main`, offset: `10` },
      { path: `/chat/three/main`, offset: `4` },
    ])
  })

  it(`uses the latest ack per path and compares numeric strings as numbers`, () => {
    expect(
      subtractAckedSourceStreamsFromPending(
        [{ path: `/chat/one/main`, offset: `10` }],
        [
          { path: `/chat/one/main`, offset: `9` },
          { path: `/chat/one/main`, offset: `10` },
        ]
      )
    ).toEqual([])
  })

  it(`falls back to lexicographic ordering for fixed-width non-numeric offsets`, () => {
    expect(
      subtractAckedSourceStreamsFromPending(
        [
          { path: `/chat/one/main`, offset: `0000000a` },
          { path: `/chat/two/main`, offset: `0000000b` },
        ],
        [
          { path: `/chat/one/main`, offset: `0000000a` },
          { path: `/chat/two/main`, offset: `0000000a` },
        ]
      )
    ).toEqual([{ path: `/chat/two/main`, offset: `0000000b` }])
  })
})

describe(`PostgresRegistry supersedeDispatchForStoppedEntity`, () => {
  let registry: PostgresRegistry
  let db: ReturnType<typeof createDb>[`db`]
  let client: ReturnType<typeof createDb>[`client`]

  beforeAll(async () => {
    const { createDb } = await import(`../src/db/index`)
    const { TEST_POSTGRES_URL, resetElectricAgentsTestBackend } = await import(
      `./test-backend`
    )
    const { PostgresRegistry } = await import(`../src/electric-agents-registry`)

    await resetElectricAgentsTestBackend()
    const connection = createDb(TEST_POSTGRES_URL)
    db = connection.db
    client = connection.client
    registry = new PostgresRegistry(db)
  }, 120_000)

  beforeEach(async () => {
    const { resetElectricAgentsTestBackend } = await import(`./test-backend`)
    await resetElectricAgentsTestBackend()
  }, 120_000)

  afterAll(async () => {
    await client?.end()
  }, 120_000)

  it(`expires stale active claims when raw SQL receives Date inputs`, async () => {
    const { eq } = await import(`drizzle-orm`)
    const { consumerClaims, entityDispatchState } = await import(
      `../src/db/schema`
    )
    const now = new Date(`2026-05-09T12:00:00.000Z`)

    await db.insert(entityDispatchState).values({
      entityUrl: `/chat/expired-active`,
      pendingSourceStreams: [
        { path: `/chat/expired-active/main`, offset: `21` },
      ],
      pendingReason: `message`,
      activeConsumerId: `entity:chat:expired-active`,
      activeRunnerId: `runner-1`,
      activeEpoch: 7,
      activeClaimedAt: new Date(`2026-05-09T11:50:00.000Z`),
      activeLeaseExpiresAt: new Date(`2026-05-09T11:59:00.000Z`),
    })
    await db.insert(consumerClaims).values({
      consumerId: `entity:chat:expired-active`,
      epoch: 7,
      entityUrl: `/chat/expired-active`,
      streamPath: `/chat/expired-active/main`,
      runnerId: `runner-1`,
      status: `active`,
      claimedAt: new Date(`2026-05-09T11:50:00.000Z`),
      leaseExpiresAt: new Date(`2026-05-09T11:59:00.000Z`),
    })

    await expect(registry.expireStaleActiveClaims({ now })).resolves.toEqual([
      {
        entityUrl: `/chat/expired-active`,
        pendingSourceStreams: [
          { path: `/chat/expired-active/main`, offset: `21` },
        ],
        pendingReason: `message`,
      },
    ])

    const [state] = await db
      .select()
      .from(entityDispatchState)
      .where(eq(entityDispatchState.entityUrl, `/chat/expired-active`))
    expect(state!.activeConsumerId).toBeNull()
    expect(state!.lastReleasedAt?.toISOString()).toBe(now.toISOString())

    const [claim] = await db
      .select()
      .from(consumerClaims)
      .where(eq(consumerClaims.consumerId, `entity:chat:expired-active`))
    expect(claim).toMatchObject({ status: `expired` })
    expect(claim!.releasedAt?.toISOString()).toBe(now.toISOString())
  })

  it(`expires stale outstanding wakes when raw SQL receives Date inputs`, async () => {
    const { eq } = await import(`drizzle-orm`)
    const { entityDispatchState, wakeNotifications } = await import(
      `../src/db/schema`
    )
    const now = new Date(`2026-05-09T12:00:00.000Z`)
    const staleBefore = new Date(`2026-05-09T11:59:00.000Z`)

    await db.insert(entityDispatchState).values({
      entityUrl: `/chat/stale-wake`,
      pendingSourceStreams: [{ path: `/chat/stale-wake/main`, offset: `31` }],
      outstandingWakeId: `wake-stale`,
      outstandingWakeTarget: { type: `runner`, runnerId: `runner-1` },
      outstandingWakeCreatedAt: new Date(`2026-05-09T11:58:00.000Z`),
    })
    await db.insert(wakeNotifications).values({
      wakeId: `wake-stale`,
      entityUrl: `/chat/stale-wake`,
      targetType: `runner`,
      targetRunnerId: `runner-1`,
      notificationPublic: {
        consumerId: `entity:chat:stale-wake`,
        epoch: 1,
        wakeId: `wake-stale`,
        streamPath: `/chat/stale-wake/main`,
        streams: [{ path: `/chat/stale-wake/main`, offset: `31` }],
      },
      deliveryStatus: `delivered`,
      claimStatus: `unclaimed`,
    })

    await expect(
      registry.expireStaleOutstandingWakes({ now, staleBefore })
    ).resolves.toEqual([
      {
        entityUrl: `/chat/stale-wake`,
        wakeId: `wake-stale`,
        pendingSourceStreams: [{ path: `/chat/stale-wake/main`, offset: `31` }],
        pendingReason: `stale_outstanding_wake`,
      },
    ])

    const [state] = await db
      .select()
      .from(entityDispatchState)
      .where(eq(entityDispatchState.entityUrl, `/chat/stale-wake`))
    expect(state!.outstandingWakeId).toBeNull()
    expect(state!.updatedAt?.toISOString()).toBe(now.toISOString())

    const [wake] = await db
      .select()
      .from(wakeNotifications)
      .where(eq(wakeNotifications.wakeId, `wake-stale`))
    expect(wake).toMatchObject({
      deliveryStatus: `superseded`,
      claimStatus: `expired`,
    })
    expect(wake!.resolvedAt?.toISOString()).toBe(now.toISOString())
  })

  it(`clears outstanding wake, active claim, and pending work for stopped entities`, async () => {
    const { eq } = await import(`drizzle-orm`)
    const { consumerClaims, entityDispatchState, wakeNotifications } =
      await import(`../src/db/schema`)
    const now = new Date(`2026-05-09T12:00:00.000Z`)

    await db.insert(entityDispatchState).values({
      entityUrl: `/chat/stopped`,
      pendingSourceStreams: [{ path: `/chat/stopped/main`, offset: `15` }],
      pendingReason: `message`,
      pendingSince: new Date(`2026-05-09T11:55:00.000Z`),
      outstandingWakeId: `wake-stopped`,
      outstandingWakeTarget: { type: `runner`, runnerId: `runner-1` },
      outstandingWakeCreatedAt: new Date(`2026-05-09T11:56:00.000Z`),
      activeConsumerId: `entity:chat:stopped`,
      activeRunnerId: `runner-1`,
      activeEpoch: 3,
      activeClaimedAt: new Date(`2026-05-09T11:57:00.000Z`),
      activeLeaseExpiresAt: new Date(`2026-05-09T12:02:00.000Z`),
    })
    await db.insert(wakeNotifications).values({
      wakeId: `wake-stopped`,
      entityUrl: `/chat/stopped`,
      targetType: `runner`,
      targetRunnerId: `runner-1`,
      notificationPublic: {
        consumerId: `entity:chat:stopped`,
        epoch: 3,
        wakeId: `wake-stopped`,
        streamPath: `/chat/stopped/main`,
        streams: [{ path: `/chat/stopped/main`, offset: `15` }],
      },
      deliveryStatus: `delivered`,
      claimStatus: `claimed`,
    })
    await db.insert(consumerClaims).values({
      consumerId: `entity:chat:stopped`,
      epoch: 3,
      wakeId: `wake-stopped`,
      entityUrl: `/chat/stopped`,
      streamPath: `/chat/stopped/main`,
      runnerId: `runner-1`,
      status: `active`,
      claimedAt: new Date(`2026-05-09T11:57:00.000Z`),
      leaseExpiresAt: new Date(`2026-05-09T12:02:00.000Z`),
    })

    await expect(
      registry.supersedeDispatchForStoppedEntity({
        entityUrl: `/chat/stopped`,
        now,
      })
    ).resolves.toEqual({
      matched: true,
      outstandingWakeId: `wake-stopped`,
      activeConsumerId: `entity:chat:stopped`,
      activeEpoch: 3,
      clearedPendingSourceStreams: [
        { path: `/chat/stopped/main`, offset: `15` },
      ],
    })

    const [state] = await db
      .select()
      .from(entityDispatchState)
      .where(eq(entityDispatchState.entityUrl, `/chat/stopped`))
    expect(state).toMatchObject({
      pendingSourceStreams: [],
      pendingReason: null,
      pendingSince: null,
      outstandingWakeId: null,
      outstandingWakeTarget: null,
      outstandingWakeCreatedAt: null,
      activeConsumerId: null,
      activeRunnerId: null,
      activeEpoch: null,
      activeClaimedAt: null,
      activeLeaseExpiresAt: null,
    })
    expect(state!.lastReleasedAt?.toISOString()).toBe(now.toISOString())

    const [wake] = await db
      .select()
      .from(wakeNotifications)
      .where(eq(wakeNotifications.wakeId, `wake-stopped`))
    expect(wake).toMatchObject({
      deliveryStatus: `superseded`,
      claimStatus: `expired`,
    })
    expect(wake!.resolvedAt?.toISOString()).toBe(now.toISOString())

    const [claim] = await db
      .select()
      .from(consumerClaims)
      .where(eq(consumerClaims.consumerId, `entity:chat:stopped`))
    expect(claim).toMatchObject({ status: `failed` })
    expect(claim!.releasedAt?.toISOString()).toBe(now.toISOString())
  })
})
