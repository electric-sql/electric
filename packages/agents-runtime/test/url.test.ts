import { describe, expect, it } from 'vitest'
import { appendPathToUrl } from '../src/url'

describe(`appendPathToUrl`, () => {
  it(`appends paths without query params`, () => {
    expect(appendPathToUrl(`http://agents.test`, `/chat/one`)).toBe(
      `http://agents.test/chat/one`
    )
  })

  it(`canonicalizes tenant routing query params into path prefixes`, () => {
    expect(
      appendPathToUrl(
        `https://agents.test?service=tenant-a&secret=shared-secret`,
        `/_electric/entity-types`
      )
    ).toBe(
      `https://agents.test/t/tenant-a/v1/_electric/entity-types?secret=shared-secret`
    )
  })

  it(`keeps path query params after tenant base params`, () => {
    expect(
      appendPathToUrl(
        `https://agents.test/t/tenant-a/v1?secret=shared-secret`,
        `/chat/*/main?mode=tail`
      )
    ).toBe(
      `https://agents.test/t/tenant-a/v1/chat/*/main?secret=shared-secret&mode=tail`
    )
  })

  it(`does not duplicate an existing tenant path prefix`, () => {
    expect(
      appendPathToUrl(
        `https://agents.test/base/t/tenant-a/v1?tenant=tenant-a&foo=bar`,
        `/_electric/entity-types`
      )
    ).toBe(
      `https://agents.test/base/t/tenant-a/v1/_electric/entity-types?foo=bar`
    )
  })
})
