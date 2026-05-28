import { describe, expect, it } from 'vitest'
import { entityApiPath, entityApiUrl } from '../src/entity-api'

describe(`entity API helpers`, () => {
  it(`routes entity API calls through the control-plane router`, () => {
    expect(entityApiPath(`/horton/demo`)).toBe(
      `/_electric/entities/horton/demo`
    )
    expect(entityApiPath(`horton/demo`, `/send`)).toBe(
      `/_electric/entities/horton/demo/send`
    )
  })

  it(`builds absolute entity API URLs without duplicate slashes`, () => {
    expect(entityApiUrl(`http://server/`, `/horton/demo`, `/fork`)).toBe(
      `http://server/_electric/entities/horton/demo/fork`
    )
  })

  it(`builds entity API URLs below tenant path prefixes`, () => {
    expect(
      entityApiUrl(`http://server/t/svc-123/v1`, `/horton/demo`, `/fork`)
    ).toBe(`http://server/t/svc-123/v1/_electric/entities/horton/demo/fork`)
  })
})
