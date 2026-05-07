import { describe, expect, it } from 'vitest'
import { createSdkOAuthProvider } from '../../src/auth/sdk-provider'
import { createAuthStore } from '../../src/credentials/auth-store'

describe(`createSdkOAuthProvider`, () => {
  it(`round-trips tokens via the internal auth store`, async () => {
    const authStore = createAuthStore()
    const p = createSdkOAuthProvider({
      server: `mock`,
      publicUrl: `http://r:4448`,
      authStore,
      scopes: [`mcp:read`],
    })
    expect(p.redirectUrl).toBe(`http://r:4448/oauth/callback/mock`)
    await p.saveTokens({ access_token: `AT`, token_type: `Bearer` } as any)
    expect((await p.tokens())?.access_token).toBe(`AT`)
  })

  it(`captures the authorize URL via redirectToAuthorization for the addServer envelope`, async () => {
    const authStore = createAuthStore()
    const p = createSdkOAuthProvider({
      server: `mock`,
      publicUrl: `http://r:4448`,
      authStore,
      scopes: [`mcp:read`],
    })
    p.redirectToAuthorization(new URL(`https://provider/authorize?x=1`))
    expect(p.peekAuthUrl()).toBe(`https://provider/authorize?x=1`)
  })

  it(`round-trips DCR client info`, async () => {
    const authStore = createAuthStore()
    const p = createSdkOAuthProvider({
      server: `mock`,
      publicUrl: `http://r:4448`,
      authStore,
      scopes: [`mcp:read`],
    })
    await p.saveClientInformation({ client_id: `cid` } as any)
    expect((await p.clientInformation())?.client_id).toBe(`cid`)
  })

  it(`honors a redirectUri override from auth config`, () => {
    const authStore = createAuthStore()
    const p = createSdkOAuthProvider({
      server: `mock`,
      publicUrl: `http://r:4448`,
      authStore,
      scopes: [`mcp:read`],
      redirectUri: `http://custom/cb`,
    })
    expect(p.redirectUrl).toBe(`http://custom/cb`)
  })

  it(`clearAuthUrl resets the captured auth URL to undefined`, () => {
    const authStore = createAuthStore()
    const p = createSdkOAuthProvider({
      server: `mock`,
      publicUrl: `http://r:4448`,
      authStore,
      scopes: [`mcp:read`],
    })
    p.redirectToAuthorization(new URL(`https://provider/authorize?x=1`))
    expect(p.peekAuthUrl()).toBeDefined()
    p.clearAuthUrl()
    expect(p.peekAuthUrl()).toBeUndefined()
  })
})
