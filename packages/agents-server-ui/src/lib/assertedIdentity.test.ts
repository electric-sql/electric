import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  __resetAssertedIdentityCacheForTests,
  formatAssertedIdentity,
  preloadDesktopFormattedAssertedIdentity,
} from './assertedIdentity'

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

describe(`desktop asserted identity`, () => {
  afterEach(() => {
    __resetAssertedIdentityCacheForTests()
    vi.unstubAllGlobals()
  })

  it(`reads asserted auth headers case-insensitively`, async () => {
    vi.stubGlobal(`window`, {
      electronAPI: {
        getAssertedAuthHeaders: vi.fn().mockResolvedValue({
          'X-Electric-Asserted-Email': `alice@example.com`,
          'X-Electric-Asserted-Name': `Alice`,
        }),
      },
    })

    await expect(preloadDesktopFormattedAssertedIdentity()).resolves.toBe(
      `Alice <alice@example.com>`
    )
  })
})
