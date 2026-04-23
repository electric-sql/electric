import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb } from '../src/db/index'
import {
  entityBridges,
  entityManifestSources,
  tagStreamOutbox,
} from '../src/db/schema'
import { PostgresRegistry } from '../src/electric-agents-registry'
import {
  TEST_POSTGRES_URL,
  resetElectricAgentsTestBackend,
} from './test-backend'

describe(`PostgresRegistry tag outbox lifecycle`, () => {
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

  it(`increments attempts and dead-letters rows after the limit`, async () => {
    await db.insert(tagStreamOutbox).values({
      entityUrl: `/task/demo`,
      collection: `tags`,
      op: `insert`,
      key: `title`,
      rowData: { key: `title`, value: `hello` },
    })

    const [firstClaim] = await registry.claimTagOutboxRows(`worker-1`)
    expect(firstClaim).toMatchObject({
      attemptCount: 0,
      deadLetteredAt: undefined,
    })

    const firstFailure = await registry.failTagOutboxRow(
      firstClaim!.id,
      `worker-1`,
      `boom-1`,
      2
    )
    expect(firstFailure).toEqual({
      attemptCount: 1,
      deadLettered: false,
    })

    const [secondClaim] = await registry.claimTagOutboxRows(`worker-2`)
    expect(secondClaim).toMatchObject({
      id: firstClaim!.id,
      attemptCount: 1,
      lastError: `boom-1`,
    })

    const secondFailure = await registry.failTagOutboxRow(
      secondClaim!.id,
      `worker-2`,
      `boom-2`,
      2
    )
    expect(secondFailure).toEqual({
      attemptCount: 2,
      deadLettered: true,
    })

    const [stored] = await db
      .select()
      .from(tagStreamOutbox)
      .where(eq(tagStreamOutbox.id, firstClaim!.id))
    expect(stored!.attemptCount).toBe(2)
    expect(stored!.lastError).toBe(`boom-2`)
    expect(stored!.deadLetteredAt).toBeTruthy()

    expect(await registry.claimTagOutboxRows(`worker-3`)).toEqual([])
  })

  it(`releases a worker's outstanding claims`, async () => {
    await db.insert(tagStreamOutbox).values({
      entityUrl: `/task/demo`,
      collection: `tags`,
      op: `insert`,
      key: `title`,
      rowData: { key: `title`, value: `hello` },
    })

    const [claim] = await registry.claimTagOutboxRows(`worker-1`)
    expect(claim?.claimedBy).toBe(`worker-1`)

    await registry.releaseTagOutboxClaims(`worker-1`)

    const [reclaimed] = await registry.claimTagOutboxRows(`worker-2`)
    expect(reclaimed).toMatchObject({
      id: claim!.id,
      claimedBy: `worker-2`,
    })
  })

  it(`lists stale entity bridges using a typed timestamp comparison`, async () => {
    await db.insert(entityBridges).values([
      {
        sourceRef: `stale-ref`,
        tags: { demo: `x` },
        streamUrl: `/_entities/stale-ref`,
        lastObserverActivityAt: new Date(`2026-04-15T14:00:00.000Z`),
      },
      {
        sourceRef: `fresh-ref`,
        tags: { demo: `y` },
        streamUrl: `/_entities/fresh-ref`,
        lastObserverActivityAt: new Date(`2026-04-15T15:00:00.000Z`),
      },
    ])

    const rows = await registry.listStaleEntityBridges(
      new Date(`2026-04-15T14:30:00.000Z`)
    )

    expect(rows.map((row) => row.sourceRef)).toEqual([`stale-ref`])
  })

  it(`concurrent setEntityTag calls on the same entity preserve all tags`, async () => {
    const now = Date.now()
    await registry.createEntity({
      url: `/task/concurrent-tag-test`,
      type: `test`,
      status: `running`,
      streams: { main: `/s/main`, error: `/s/error` },
      subscription_id: `sub-1`,
      write_token: `wt-1`,
      tags: {},
      created_at: now,
      updated_at: now,
    })

    // Race 10 setEntityTag calls on different keys concurrently.
    // With a read/modify/write without FOR UPDATE, the last writer wins
    // and earlier tags are silently lost.
    const NUM_KEYS = 10
    const results = await Promise.all(
      Array.from({ length: NUM_KEYS }, (_, i) =>
        registry.setEntityTag(
          `/task/concurrent-tag-test`,
          `key${i}`,
          `value${i}`
        )
      )
    )

    // All should report changed
    for (const r of results) {
      expect(r.changed).toBe(true)
    }

    // The entity should have ALL tags
    const entity = await registry.getEntity(`/task/concurrent-tag-test`)
    const expectedTags: Record<string, string> = {}
    for (let i = 0; i < NUM_KEYS; i++) {
      expectedTags[`key${i}`] = `value${i}`
    }
    expect(entity!.tags).toEqual(expectedTags)
  })

  it(`stores only active entities() manifest source refs for GC lookup`, async () => {
    await registry.replaceEntityManifestSource(
      `/task/owner-a`,
      `source:entities:ref-a`,
      `ref-a`
    )
    await registry.replaceEntityManifestSource(
      `/task/owner-b`,
      `source:entities:ref-b`,
      `ref-b`
    )
    await registry.replaceEntityManifestSource(
      `/task/owner-b`,
      `source:entities:ref-b`
    )

    expect(await registry.listReferencedEntitySourceRefs()).toEqual([`ref-a`])

    const rows = await db
      .select()
      .from(entityManifestSources)
      .orderBy(entityManifestSources.ownerEntityUrl)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      ownerEntityUrl: `/task/owner-a`,
      manifestKey: `source:entities:ref-a`,
      sourceRef: `ref-a`,
    })
  })
})
