import { describe, expect, it, vi } from 'vitest'
import { osKeychainCredentialStore } from '../../src/credentials/os-keychain'

const fakeKeytar = (() => {
  const store = new Map<string, string>()
  return {
    setPassword: vi.fn(async (svc: string, acct: string, val: string) => {
      store.set(`${svc}::${acct}`, val)
    }),
    getPassword: vi.fn(
      async (svc: string, acct: string) => store.get(`${svc}::${acct}`) ?? null
    ),
  }
})()

describe(`osKeychainCredentialStore`, () => {
  it(`round-trips tokens via the injected keytar adapter`, async () => {
    const s = osKeychainCredentialStore({
      keytar: fakeKeytar as any,
      service: `electric-agents-test`,
    })
    await s.saveOAuthTokens?.(`honeycomb`, {
      accessToken: `AT`,
      refreshToken: `RT`,
    })
    const t = await s.getOAuthTokens?.(`honeycomb`)
    expect(t?.accessToken).toBe(`AT`)
    expect(fakeKeytar.setPassword).toHaveBeenCalled()
  })

  it(`returns a noop store when keytar is missing`, async () => {
    const s = osKeychainCredentialStore({ keytar: undefined as any })
    expect(await s.getOAuthTokens?.(`x`)).toBeUndefined()
    await s.saveOAuthTokens?.(`x`, { accessToken: `AT` })
    expect(await s.getOAuthTokens?.(`x`)).toBeUndefined()
  })
})
