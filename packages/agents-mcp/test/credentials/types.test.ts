import { describe, expect, it } from 'vitest'
import type {
  CredentialStore,
  OAuthClientInfo,
  OAuthTokens,
} from '../../src/credentials/types'

describe(`CredentialStore`, () => {
  it(`all methods are optional — null store is valid`, () => {
    const store: CredentialStore = {}
    expect(store).toBeDefined()
  })

  it(`typed surface matches spec`, () => {
    const store: CredentialStore = {
      getApiKey: async () => undefined,
      getClientCredentials: async () => undefined,
      getOAuthTokens: async () => undefined,
      saveOAuthTokens: async (_s: string, _t: OAuthTokens) => {},
      getOAuthClientInfo: async () => undefined,
      saveOAuthClientInfo: async (_s: string, _c: OAuthClientInfo) => {},
    }
    expect(store).toBeDefined()
  })
})
