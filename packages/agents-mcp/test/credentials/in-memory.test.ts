import { describe, expect, it } from 'vitest'
import { inMemoryCredentialStore } from '../../src/credentials/in-memory'

describe(`inMemoryCredentialStore`, () => {
  it(`round-trips api keys, tokens, and client info`, async () => {
    const s = inMemoryCredentialStore()
    s.setApiKey(`a`, `k`)
    expect(await s.getApiKey?.(`a`)).toBe(`k`)

    await s.saveOAuthTokens?.(`a`, { accessToken: `at`, refreshToken: `rt` })
    expect((await s.getOAuthTokens?.(`a`))?.accessToken).toBe(`at`)

    await s.saveOAuthClientInfo?.(`a`, { clientId: `cid` })
    expect((await s.getOAuthClientInfo?.(`a`))?.clientId).toBe(`cid`)
  })

  it(`returns undefined for unknown server`, async () => {
    const s = inMemoryCredentialStore()
    expect(await s.getApiKey?.(`nope`)).toBeUndefined()
    expect(await s.getOAuthTokens?.(`nope`)).toBeUndefined()
  })
})
