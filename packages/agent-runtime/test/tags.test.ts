import { describe, expect, it } from 'vitest'
import { hashString, sourceRefForTags } from '../src/tags'

describe(`tags helpers`, () => {
  it(`sourceRefForTags normalizes key order before hashing`, () => {
    expect(
      sourceRefForTags({
        role: `reviewer`,
        demo_id: `X`,
      })
    ).toBe(
      sourceRefForTags({
        demo_id: `X`,
        role: `reviewer`,
      })
    )
  })

  it(`hashString uses a wider deterministic hex space`, () => {
    const hash = hashString(`{"demo_id":"X","role":"reviewer"}`)
    expect(hash).toMatch(/^[0-9a-f]{16}$/)
    expect(hash).toBe(`52df825db9cb78ff`)
  })
})
