import { describe, expect, it } from 'vitest'
import { appendPathToUrl } from '../src/url'

describe(`appendPathToUrl`, () => {
  it(`appends paths without query params`, () => {
    expect(appendPathToUrl(`http://agents.test`, `/chat/one`)).toBe(
      `http://agents.test/chat/one`
    )
  })

  it(`preserves base query params without interpreting tenant routing`, () => {
    expect(
      appendPathToUrl(
        `https://agents.test?tenant=tenant-a&secret=shared-secret`,
        `/_electric/entity-types`
      )
    ).toBe(
      `https://agents.test/_electric/entity-types?tenant=tenant-a&secret=shared-secret`
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

  it(`appends under an existing base path without rewriting it`, () => {
    expect(
      appendPathToUrl(
        `https://agents.test/base/t/tenant-a/v1?tenant=tenant-a&foo=bar`,
        `/_electric/entity-types`
      )
    ).toBe(
      `https://agents.test/base/t/tenant-a/v1/_electric/entity-types?tenant=tenant-a&foo=bar`
    )
  })
})
