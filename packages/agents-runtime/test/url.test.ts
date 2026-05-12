import { describe, expect, it } from 'vitest'
import { appendPathToUrl } from '../src/url'

describe(`appendPathToUrl`, () => {
  it(`appends paths without query params`, () => {
    expect(appendPathToUrl(`http://agents.test`, `/chat/one`)).toBe(
      `http://agents.test/chat/one`
    )
  })

  it(`preserves routing query params from the base URL`, () => {
    expect(
      appendPathToUrl(
        `https://agents.test?service=tenant-a&secret=shared-secret`,
        `/_electric/entity-types`
      )
    ).toBe(
      `https://agents.test/_electric/entity-types?service=tenant-a&secret=shared-secret`
    )
  })

  it(`keeps path query params after base routing params`, () => {
    expect(
      appendPathToUrl(
        `https://agents.test/api?service=tenant-a&secret=shared-secret`,
        `/chat/*/main?mode=tail`
      )
    ).toBe(
      `https://agents.test/api/chat/*/main?service=tenant-a&secret=shared-secret&mode=tail`
    )
  })
})
