import { describe, expect, it } from 'vitest'
import {
  assertedIdentityHeaders,
  entityApiPath,
  entityApiUrl,
} from '../src/entity-api'

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

  it(`builds asserted auth headers when an asserted identity is present`, () => {
    expect(assertedIdentityHeaders(` alice@example.test `)).toEqual({
      'x-electric-asserted-email': `alice@example.test`,
    })
    expect(assertedIdentityHeaders(` `)).toEqual({})
  })
})
