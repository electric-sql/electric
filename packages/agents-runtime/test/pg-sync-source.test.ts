import { describe, expect, it } from 'vitest'
import { getPgSyncStreamPath, pgSync } from '../src/observation-sources'

describe(`pgSync observation source`, () => {
  it(`uses the pgSync source type`, () => {
    expect(pgSync({ table: `todos` }).sourceType).toBe(`pgSync`)
  })

  it(`produces deterministic equivalent sourceRefs`, () => {
    expect(
      pgSync({
        table: `todos`,
        where: `priority = $1`,
        params: { priority: `high`, org: `acme` },
        replica: `full`,
      }).sourceRef
    ).toBe(
      pgSync({
        table: `todos`,
        where: `priority = $1`,
        params: { org: `acme`, priority: `high` },
        replica: `full`,
      }).sourceRef
    )
  })

  it(`changes sourceRef for different table, where, and params`, () => {
    const base = pgSync({
      table: `todos`,
      where: `done = $1`,
      params: [`false`],
    })
    expect(
      pgSync({ table: `tasks`, where: `done = $1`, params: [`false`] })
        .sourceRef
    ).not.toBe(base.sourceRef)
    expect(
      pgSync({ table: `todos`, where: `done = $2`, params: [`false`] })
        .sourceRef
    ).not.toBe(base.sourceRef)
    expect(
      pgSync({ table: `todos`, where: `done = $1`, params: [`true`] }).sourceRef
    ).not.toBe(base.sourceRef)
  })

  it(`sets streamUrl from sourceRef`, () => {
    const source = pgSync({ table: `todos` })
    expect(source.streamUrl).toBe(getPgSyncStreamPath(source.sourceRef))
    expect(source.streamUrl).toBe(`/_electric/pg-sync/${source.sourceRef}`)
  })

  it(`serializes a JSON-safe manifest config`, () => {
    const entry = pgSync({
      table: `todos`,
      columns: [`id`, `text`],
      where: `priority = $1`,
      params: { priority: `high` },
      replica: `full`,
    }).toManifestEntry()
    expect(JSON.parse(JSON.stringify(entry.config))).toEqual({
      table: `todos`,
      columns: [`id`, `text`],
      where: `priority = $1`,
      params: { priority: `high` },
      replica: `full`,
    })
  })

  it(`defaults wake to the pg-sync stream and change collection`, () => {
    const source = pgSync({ table: `todos` })
    expect(source.wake?.()).toEqual({
      sourceUrl: source.streamUrl,
      condition: { on: `change`, collections: [`pg_sync_change`] },
    })
  })

  it(`ignores params object key ordering`, () => {
    expect(
      pgSync({ table: `todos`, params: { b: `2`, a: `1` } }).sourceRef
    ).toBe(pgSync({ table: `todos`, params: { a: `1`, b: `2` } }).sourceRef)
  })

  it(`omits undefined optional fields consistently`, () => {
    expect(
      pgSync({
        table: `todos`,
        columns: undefined,
        where: undefined,
        params: undefined,
        replica: undefined,
      }).toManifestEntry().config
    ).toEqual({ table: `todos`, replica: `default` })
    expect(pgSync({ table: `todos`, where: undefined }).sourceRef).toBe(
      pgSync({ table: `todos` }).sourceRef
    )
  })

  it(`preserves columns order as sourceRef-significant`, () => {
    expect(
      pgSync({ table: `todos`, columns: [`id`, `text`] }).sourceRef
    ).not.toBe(pgSync({ table: `todos`, columns: [`text`, `id`] }).sourceRef)
  })

  it(`treats omitted replica as replica default`, () => {
    expect(pgSync({ table: `todos` }).sourceRef).toBe(
      pgSync({ table: `todos`, replica: `default` }).sourceRef
    )
  })
})
