import { describe, expect, it } from 'vitest'
import {
  createDevAssertedAuthenticateRequest,
  devAssertedAuthOptionsFromEnv,
} from '../src/dev-asserted-auth'

function req(headers: Record<string, string | undefined>): Request {
  const requestHeaders = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) requestHeaders.set(key, value)
  }
  return new Request(`http://agents.test/`, { headers: requestHeaders })
}

describe(`dev asserted auth`, () => {
  it(`is disabled by default`, () => {
    expect(
      createDevAssertedAuthenticateRequest(devAssertedAuthOptionsFromEnv({}))
    ).toBeUndefined()
  })

  it(`returns null when enabled but no identity is supplied`, () => {
    const auth = createDevAssertedAuthenticateRequest({ enabled: true })!
    expect(auth(req({}))).toBeNull()
  })

  it(`authenticates from asserted headers using email as userId`, () => {
    const auth = createDevAssertedAuthenticateRequest({ enabled: true })!
    expect(
      auth(
        req({
          'x-electric-asserted-email': `alice@example.com`,
          'x-electric-asserted-name': `Alice`,
        })
      )
    ).toEqual({
      userId: `alice@example.com`,
      email: `alice@example.com`,
      name: `Alice`,
    })
  })

  it(`falls back to defaults and then name for userId`, () => {
    const auth = createDevAssertedAuthenticateRequest({
      enabled: true,
      defaultName: `Desktop A`,
    })!
    expect(auth(req({}))).toEqual({
      userId: `Desktop A`,
      email: undefined,
      name: `Desktop A`,
    })
  })

  it(`reads enable flag and default identity from environment`, () => {
    const auth = createDevAssertedAuthenticateRequest(
      devAssertedAuthOptionsFromEnv({
        ELECTRIC_AGENTS_DEV_ASSERTED_AUTH: `1`,
        ELECTRIC_ASSERTED_AUTH_EMAIL: `default@example.com`,
        ELECTRIC_ASSERTED_AUTH_NAME: `Default User`,
      })
    )!

    expect(auth(req({}))).toEqual({
      userId: `default@example.com`,
      email: `default@example.com`,
      name: `Default User`,
    })
  })
})
