import { describe, expect, it } from 'vitest'
import { envCredentialStore } from '../../src/credentials/env'

describe(`envCredentialStore`, () => {
  it(`reads MCP_<SERVER>_API_KEY`, async () => {
    const s = envCredentialStore({
      MCP_STRIPE_API_KEY: `rk_x`,
    } as NodeJS.ProcessEnv)
    expect(await s.getApiKey?.(`stripe`)).toBe(`rk_x`)
    expect(await s.getApiKey?.(`STRIPE`)).toBe(`rk_x`)
    expect(await s.getApiKey?.(`other`)).toBeUndefined()
  })
  it(`reads MCP_<SERVER>_CLIENT_ID and CLIENT_SECRET as a pair`, async () => {
    const env = {
      MCP_X_CLIENT_ID: `id`,
      MCP_X_CLIENT_SECRET: `sec`,
    } as NodeJS.ProcessEnv
    const s = envCredentialStore(env)
    expect(await s.getClientCredentials?.(`x`)).toEqual({
      clientId: `id`,
      clientSecret: `sec`,
    })
  })
  it(`returns undefined when only one of id/secret is set`, async () => {
    const s = envCredentialStore({ MCP_X_CLIENT_ID: `id` } as NodeJS.ProcessEnv)
    expect(await s.getClientCredentials?.(`x`)).toBeUndefined()
  })
  it(`does not implement save methods`, () => {
    const s = envCredentialStore()
    expect(s.saveOAuthTokens).toBeUndefined()
    expect(s.saveOAuthClientInfo).toBeUndefined()
  })
  it(`handles dashes by converting to underscores`, async () => {
    const s = envCredentialStore({
      MCP_FOO_BAR_API_KEY: `k`,
    } as NodeJS.ProcessEnv)
    expect(await s.getApiKey?.(`foo-bar`)).toBe(`k`)
  })
})
