import { describe, expect, it } from 'vitest'
import { formatAssertedIdentity } from './assertedIdentity'

describe(`asserted identity formatting`, () => {
  it(`formats as Git-style name and email with fallbacks`, () => {
    expect(
      formatAssertedIdentity({
        name: `Alice`,
        email: `alice@example.com`,
        userId: `alice-id`,
      })
    ).toBe(`Alice <alice@example.com>`)
    expect(formatAssertedIdentity({ email: `alice@example.com` })).toBe(
      `alice@example.com`
    )
    expect(formatAssertedIdentity({ name: `Alice` })).toBe(`Alice`)
    expect(formatAssertedIdentity({ userId: `alice-id` })).toBe(`alice-id`)
  })
})
