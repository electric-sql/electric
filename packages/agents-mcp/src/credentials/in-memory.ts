import type { CredentialStore, OAuthClientInfo, OAuthTokens } from './types'

export interface InMemoryCredentialStore extends CredentialStore {
  setApiKey(server: string, key: string): void
  setClientCredentials(
    server: string,
    c: { clientId: string; clientSecret: string }
  ): void
}

export function inMemoryCredentialStore(): InMemoryCredentialStore {
  const apiKeys = new Map<string, string>()
  const cc = new Map<string, { clientId: string; clientSecret: string }>()
  const tokens = new Map<string, OAuthTokens>()
  const clientInfo = new Map<string, OAuthClientInfo>()

  return {
    setApiKey: (s, k) => void apiKeys.set(s, k),
    setClientCredentials: (s, v) => void cc.set(s, v),
    getApiKey: (s) => apiKeys.get(s),
    getClientCredentials: (s) => cc.get(s),
    getOAuthTokens: (s) => tokens.get(s),
    saveOAuthTokens: (s, t) => void tokens.set(s, t),
    getOAuthClientInfo: (s) => clientInfo.get(s),
    saveOAuthClientInfo: (s, c) => void clientInfo.set(s, c),
  }
}
