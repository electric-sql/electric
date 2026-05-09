import { describe, expect, it } from 'vitest'
import type { IncomingMessage } from 'node:http'
import {
  createDevAssertedAuthenticateRequest,
  devAssertedAuthOptionsFromEnv,
} from '../src/dev-asserted-auth'

function req(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as IncomingMessage
}

describe(`dev asserted auth`, () => {
  it(`is disabled by default`, () => {
    expect(
      createDevAssertedAuthenticateRequest(devAssertedAuthOptionsFromEnv({}))
    ).toBeUndefined()
  })

  it(`returns null when enabled but no identity is supplied`, async () => {
    const auth = createDevAssertedAuthenticateRequest({ enabled: true })!
    expect(auth(req({}))).toBeNull()
  })

  it(`authenticates from asserted headers using email as userId`, async () => {
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

  it(`falls back to defaults and then name for userId`, async () => {
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
})
