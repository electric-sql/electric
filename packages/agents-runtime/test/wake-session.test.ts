import { describe, expect, it, vi } from 'vitest'
import {
  createCollection,
  eq,
  localOnlyCollectionOptions,
  queryOnce,
} from '@durable-streams/state'
import { createWakeSession } from '../src/wake-session'
import type { ManifestEntry } from '../src/types'

type WakeSessionDb = Parameters<typeof createWakeSession>[0]

function mockDb(manifests: Array<ManifestEntry> = []): WakeSessionDb {
  const manifestCollection = createCollection(
    localOnlyCollectionOptions({
      id: `wake-session-manifests`,
      getKey: (row: ManifestEntry) => row.key,
      initialData: manifests,
    })
  )
  return {
    collections: {
      manifests: manifestCollection,
    },
    utils: {
      awaitTxId: vi.fn().mockResolvedValue(undefined),
    },
  }
}

describe(`WakeSession`, () => {
  it(`dedupes manifest entries against persisted manifests`, () => {
    const session = createWakeSession(
      mockDb([
        {
          kind: `source`,
          key: `source:entity:/worker-1`,
          sourceType: `entity`,
          sourceRef: `/worker-1`,
          config: { entityUrl: `/worker-1` },
        },
      ])
    )

    const duplicate: ManifestEntry = {
      kind: `source`,
      key: `source:entity:/worker-1`,
      sourceType: `entity`,
      sourceRef: `/worker-1`,
      config: { entityUrl: `/worker-1` },
    }
    const fresh: ManifestEntry = {
      kind: `source`,
      key: `source:entity:/worker-2`,
      sourceType: `entity`,
      sourceRef: `/worker-2`,
      config: { entityUrl: `/worker-2` },
    }

    expect(session.registerManifestEntry(duplicate)).toBe(false)
    expect(session.registerManifestEntry(fresh)).toBe(true)
    expect(session.getManifest()).toEqual([fresh])
  })

  it(`enqueueSend collects sends in pendingSends`, () => {
    const session = createWakeSession(mockDb())

    session.enqueueSend({ targetUrl: `child-1`, payload: { text: `ping` } })
    session.enqueueSend({ targetUrl: `child-2`, payload: { text: `pong` } })

    const sends = session.getPendingSends()
    expect(sends).toHaveLength(2)
    expect(sends[0]).toEqual({
      targetUrl: `child-1`,
      payload: { text: `ping` },
    })
    expect(sends[1]).toEqual({
      targetUrl: `child-2`,
      payload: { text: `pong` },
    })
  })

  it(`stages manifest rows through a real transaction so direct queries can see them before commit`, async () => {
    const db = mockDb()
    const session = createWakeSession(db)
    const row: ManifestEntry = {
      kind: `source`,
      key: `source:entity:/worker-3`,
      sourceType: `entity`,
      sourceRef: `/worker-3`,
      config: { entityUrl: `/worker-3` },
    }

    session.registerManifestEntry(row)

    const stagedRow = await queryOnce((q) =>
      q
        .from({ manifests: db.collections.manifests })
        .where(({ manifests }) => eq(manifests.key, row.key))
        .findOne()
    )

    expect(stagedRow).toMatchObject(row)
  })

  it(`rolls back optimistic manifest rows when the handler pass fails`, async () => {
    const db = mockDb()
    const session = createWakeSession(db)
    const row: ManifestEntry = {
      kind: `source`,
      key: `source:entity:/worker-4`,
      sourceType: `entity`,
      sourceRef: `/worker-4`,
      config: { entityUrl: `/worker-4` },
    }

    session.registerManifestEntry(row)
    session.rollbackManifestEntries()

    const rolledBackRow = await queryOnce((q) =>
      q
        .from({ manifests: db.collections.manifests })
        .where(({ manifests }) => eq(manifests.key, row.key))
        .findOne()
    )

    expect(rolledBackRow).toBeUndefined()
  })

  it(`commits manifest rows and dedupes identical future registrations`, async () => {
    const db = mockDb()
    const session = createWakeSession(db)
    const row: ManifestEntry = {
      kind: `source`,
      key: `source:entity:/worker-5`,
      sourceType: `entity`,
      sourceRef: `/worker-5`,
      config: { entityUrl: `/worker-5` },
    }

    session.registerManifestEntry(row)
    await session.commitManifestEntries()

    const committedRow = await queryOnce((q) =>
      q
        .from({ manifests: db.collections.manifests })
        .where(({ manifests }) => eq(manifests.key, row.key))
        .findOne()
    )

    expect(committedRow).toMatchObject(row)
    expect(session.registerManifestEntry(row)).toBe(false)
  })

  it(`finishSetup transitions to active phase`, () => {
    const session = createWakeSession(mockDb())
    expect(session.getPhase()).toBe(`setup`)

    session.finishSetup()
    expect(session.getPhase()).toBe(`active`)
  })

  it(`close transitions to closed phase and rejects new sends`, async () => {
    const session = createWakeSession(mockDb())
    session.finishSetup()

    await session.close()
    expect(session.getPhase()).toBe(`closed`)

    expect(() =>
      session.enqueueSend({ targetUrl: `child-4`, payload: { text: `late` } })
    ).toThrow(`wake is closing`)
  })
})
