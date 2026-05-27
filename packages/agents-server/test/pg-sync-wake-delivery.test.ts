import { describe, expect, it } from 'vitest'
import { WakeRegistry } from '../src/wake-registry'

function createDb() {
  let id = 0
  return {
    insert: () => ({
      values: () => ({
        onConflictDoNothing: () => ({
          returning: async () => [{ id: ++id }],
        }),
      }),
    }),
  }
}

function event(operation: `insert` | `update` | `delete`, key = operation) {
  return {
    type: `pg_sync_change`,
    key,
    value: {
      key,
      operation,
      value: { id: `entity-1`, status: `running` },
      oldValue: { id: `entity-1`, status: `spawning` },
    },
    headers: { operation, timestamp: new Date().toISOString() },
  }
}

describe(`pgSync wake delivery matching`, () => {
  it(`insert wakes insert subscriber and delete does not wake insert-only subscriber`, async () => {
    const registry = new WakeRegistry(createDb() as any, `default`)
    await registry.register({
      subscriberUrl: `/horton/a`,
      sourceUrl: `/_electric/pg-sync/test`,
      condition: { on: `change`, ops: [`insert`] },
      oneShot: false,
    })

    const insertResults = registry.evaluate(
      `/_electric/pg-sync/test`,
      event(`insert`),
      `default`
    )
    expect(insertResults.map((r) => r.subscriberUrl)).toEqual([`/horton/a`])
    expect(insertResults[0]!.wakeMessage.changes[0]).toMatchObject({
      value: { id: `entity-1`, status: `running` },
      oldValue: { id: `entity-1`, status: `spawning` },
    })
    expect(
      registry.evaluate(`/_electric/pg-sync/test`, event(`delete`), `default`)
    ).toEqual([])
  })

  it(`splits two subscribers on the same source by operation`, async () => {
    const registry = new WakeRegistry(createDb() as any, `default`)
    await registry.register({
      subscriberUrl: `/horton/a`,
      sourceUrl: `/_electric/pg-sync/test`,
      condition: { on: `change`, ops: [`insert`] },
      oneShot: false,
    })
    await registry.register({
      subscriberUrl: `/horton/b`,
      sourceUrl: `/_electric/pg-sync/test`,
      condition: { on: `change`, ops: [`delete`] },
      oneShot: false,
    })

    expect(
      registry
        .evaluate(`/_electric/pg-sync/test`, event(`insert`), `default`)
        .map((r) => r.subscriberUrl)
    ).toEqual([`/horton/a`])
    expect(
      registry
        .evaluate(`/_electric/pg-sync/test`, event(`delete`), `default`)
        .map((r) => r.subscriberUrl)
    ).toEqual([`/horton/b`])
  })

  it(`filters pgSync events by collection`, async () => {
    const registry = new WakeRegistry(createDb() as any, `default`)
    await registry.register({
      subscriberUrl: `/horton/a`,
      sourceUrl: `/_electric/pg-sync/test`,
      condition: { on: `change`, collections: [`pg_sync_change`] },
      oneShot: false,
    })

    expect(
      registry.evaluate(`/_electric/pg-sync/test`, event(`insert`), `default`)
    ).toHaveLength(1)
    expect(
      registry.evaluate(
        `/_electric/pg-sync/test`,
        { ...event(`insert`), type: `other` },
        `default`
      )
    ).toEqual([])
  })
})
