import { describe, expect, it } from 'vitest'
import {
  buildManifestWakeRegistration,
  extractManifestSourceUrl,
} from '../src/manifest-side-effects'

const getPgSyncStreamPath = (sourceRef: string) =>
  `/_electric/pg-sync/${sourceRef}`

describe(`manifest side effects`, () => {
  it(`uses sourceRef for entity manifest wakes when config has no entityUrl`, () => {
    const registration = buildManifestWakeRegistration(
      `/parent/p1`,
      {
        kind: `source`,
        sourceType: `entity`,
        sourceRef: `/worker/w1`,
        wake: `runFinished`,
      },
      `source:entity:/worker/w1`
    )

    expect(registration).toMatchObject({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/worker/w1`,
      condition: `runFinished`,
      oneShot: false,
      manifestKey: `source:entity:/worker/w1`,
    })
  })

  it(`accepts object-form runFinished manifest wakes`, () => {
    const registration = buildManifestWakeRegistration(
      `/parent/p1`,
      {
        kind: `source`,
        sourceType: `entity`,
        sourceRef: `/worker/w1`,
        wake: { on: `runFinished`, includeResponse: false },
      },
      `source:entity:/worker/w1`
    )

    expect(registration).toMatchObject({
      subscriberUrl: `/parent/p1`,
      sourceUrl: `/worker/w1`,
      condition: `runFinished`,
      oneShot: false,
      includeResponse: false,
      manifestKey: `source:entity:/worker/w1`,
    })
  })

  it(`maps pgSync source manifest sourceRef to pg-sync stream path`, () => {
    const sourceRef = `pg_abc123`

    expect(
      extractManifestSourceUrl({
        kind: `source`,
        sourceType: `pgSync`,
        sourceRef,
      })
    ).toBe(getPgSyncStreamPath(sourceRef))
  })

  it(`builds pgSync change wake registrations with ops`, () => {
    const sourceRef = `pg_delete_source`
    const registration = buildManifestWakeRegistration(
      `/parent/p1`,
      {
        kind: `source`,
        sourceType: `pgSync`,
        sourceRef,
        wake: { on: `change`, ops: [`delete`] },
      },
      `source:pgSync:${sourceRef}`
    )

    expect(registration).toEqual({
      subscriberUrl: `/parent/p1`,
      sourceUrl: getPgSyncStreamPath(sourceRef),
      condition: {
        on: `change`,
        ops: [`delete`],
      },
      debounceMs: undefined,
      timeoutMs: undefined,
      oneShot: false,
      manifestKey: `source:pgSync:${sourceRef}`,
    })
  })

  it(`does not register pgSync source manifests without sourceRef`, () => {
    const manifest = {
      kind: `source`,
      sourceType: `pgSync`,
      wake: { on: `change`, ops: [`delete`] },
    }

    expect(extractManifestSourceUrl(manifest)).toBeUndefined()
    expect(buildManifestWakeRegistration(`/parent/p1`, manifest)).toBeNull()
  })

  it(`preserves pgSync object-form wake collections, ops, debounceMs, and timeoutMs`, () => {
    const sourceRef = `pg_object_wake`
    const registration = buildManifestWakeRegistration(`/parent/p1`, {
      kind: `source`,
      sourceType: `pgSync`,
      sourceRef,
      wake: {
        on: `change`,
        collections: [`pg_sync_change`],
        ops: [`insert`, `update`],
        debounceMs: 250,
        timeoutMs: 5_000,
      },
    })

    expect(registration).toEqual({
      subscriberUrl: `/parent/p1`,
      sourceUrl: getPgSyncStreamPath(sourceRef),
      condition: {
        on: `change`,
        collections: [`pg_sync_change`],
        ops: [`insert`, `update`],
      },
      debounceMs: 250,
      timeoutMs: 5_000,
      oneShot: false,
      manifestKey: undefined,
    })
  })
})
