import { describe, expect, it } from 'vitest'
import { buildManifestWakeRegistration } from '../src/manifest-side-effects'

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
})
