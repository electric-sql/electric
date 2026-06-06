import { describe, expect, it } from 'vitest'
import { bucketEntities, groupByRunner } from './sessionGroups'
import type { ElectricEntity } from './ElectricAgentsProvider'

const NOW = new Date(`2026-05-03T12:00:00Z`)

function entity(url: string, updated: Date | string): ElectricEntity {
  const ts =
    typeof updated === `string`
      ? new Date(updated).getTime()
      : updated.getTime()
  return {
    url,
    type: `worker`,
    status: `idle`,
    tags: {},
    spawn_args: {},
    parent: null,
    created_at: ts,
    updated_at: ts,
  } as unknown as ElectricEntity
}

function runnerEntity(
  url: string,
  updated: Date,
  runnerId: string | null
): ElectricEntity {
  return {
    ...entity(url, updated),
    dispatch_policy: runnerId
      ? { targets: [{ type: `runner`, runnerId }] }
      : null,
  } as unknown as ElectricEntity
}

describe(`bucketEntities`, () => {
  it(`returns an empty array for no entities`, () => {
    expect(bucketEntities([], NOW)).toEqual([])
  })

  it(`drops empty buckets`, () => {
    const groups = bucketEntities([entity(`/a`, NOW)], NOW)
    expect(groups.map((g) => g.key)).toEqual([`today`])
  })

  it(`buckets across the canonical boundaries`, () => {
    const day = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000)
    const groups = bucketEntities(
      [
        entity(`/today`, day(0)),
        entity(`/yesterday`, day(1)),
        entity(`/3d`, day(3)),
        entity(`/7d`, day(7)),
        entity(`/8d`, day(8)),
        entity(`/30d`, day(30)),
        entity(`/45d`, day(45)),
        entity(`/200d`, day(200)),
        entity(`/2y`, day(800)),
      ],
      NOW
    )

    expect(groups.map((g) => [g.key, g.items.map((i) => i.url)])).toEqual([
      [`today`, [`/today`]],
      [`yesterday`, [`/yesterday`]],
      [`last7`, [`/3d`, `/7d`]],
      [`last30`, [`/8d`, `/30d`]],
      [`month`, [`/45d`]],
      [`month`, [`/200d`]],
      [`older`, [`/2y`]],
    ])
  })

  it(`orders months newest-first`, () => {
    const groups = bucketEntities(
      [
        entity(`/jan`, `2026-01-15T00:00:00Z`),
        entity(`/mar`, `2026-03-15T00:00:00Z`),
        entity(`/feb`, `2026-02-15T00:00:00Z`),
      ],
      NOW
    )
    expect(groups.map((g) => g.label)).toEqual([
      `March 2026`,
      `February 2026`,
      `January 2026`,
    ])
  })

  it(`sorts items inside each bucket by updated_at desc`, () => {
    const earlier = new Date(NOW.getTime() - 60_000)
    const later = NOW
    const groups = bucketEntities(
      [entity(`/a`, earlier), entity(`/b`, later)],
      NOW
    )
    expect(groups[0].items.map((i) => i.url)).toEqual([`/b`, `/a`])
  })

  it(`accepts seconds-since-epoch updated_at values`, () => {
    const ts = Math.floor(NOW.getTime() / 1000)
    const e = {
      ...entity(`/sec`, NOW),
      updated_at: ts,
      created_at: ts,
    } as ElectricEntity
    const groups = bucketEntities([e], NOW)
    expect(groups[0].key).toBe(`today`)
  })
})

describe(`groupByRunner`, () => {
  const day = (n: number): Date => new Date(NOW.getTime() - n * 86_400_000)
  const labels = new Map([
    [`r1`, `Runner One`],
    [`r2`, `Runner Two`],
  ])

  it(`buckets by pinned runner, most-populous first`, () => {
    const groups = groupByRunner(
      [
        runnerEntity(`/a`, day(0), `r1`),
        runnerEntity(`/b`, day(1), `r2`),
        runnerEntity(`/c`, day(2), `r1`),
      ],
      labels
    )
    expect(groups.map((g) => [g.label, g.items.map((i) => i.url)])).toEqual([
      [`Runner One`, [`/a`, `/c`]],
      [`Runner Two`, [`/b`]],
    ])
  })

  it(`collects entities with no pinned runner in a trailing None bucket`, () => {
    const groups = groupByRunner(
      [runnerEntity(`/a`, day(0), `r1`), runnerEntity(`/none`, day(1), null)],
      labels
    )
    expect(groups.map((g) => g.id)).toEqual([`runner:r1`, `runner:none`])
    expect(groups[1].label).toBe(`None`)
    expect(groups[1].items.map((i) => i.url)).toEqual([`/none`])
  })

  it(`falls back to a shortened id when no label is known`, () => {
    const groups = groupByRunner(
      [runnerEntity(`/a`, day(0), `abcdefghijklmnop`)],
      new Map()
    )
    expect(groups[0].label).toBe(`abcdefgh…`)
    expect(groups[0].title).toBe(`abcdefghijklmnop`)
  })

  it(`returns an empty array for no entities`, () => {
    expect(groupByRunner([], labels)).toEqual([])
  })
})
