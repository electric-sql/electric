// Internal — do not export from src/index.ts. Instantiated once per
// registry; lives in-process. Cross-process persistence is the operator's
// concern via the hooks declared on the auth config (see types.ts).
import type { OAuthClientInfo, OAuthTokens } from '../types'
import type { AuthStore, AuthStoreHooks } from './types'

export interface InternalAuthStore extends AuthStore {
  /** Pre-seed the cache with tokens read from `auth.tokens`. */
  seedTokens(server: string, tokens: OAuthTokens): void
  /** Pre-seed the cache with a pre-registered OAuth client. */
  seedClient(server: string, client: OAuthClientInfo): void
  /** Register per-server hooks declared on the auth config. */
  registerHooks(server: string, hooks: AuthStoreHooks): void
  /** Drop everything we know about a server (used by `removeServer`). */
  forget(server: string): void
}

export function createAuthStore(): InternalAuthStore {
  const tokens = new Map<string, OAuthTokens>()
  const clients = new Map<string, OAuthClientInfo>()
  const hooks = new Map<string, AuthStoreHooks>()

  return {
    seedTokens(server, t) {
      tokens.set(server, t)
    },
    seedClient(server, c) {
      clients.set(server, c)
    },
    registerHooks(server, h) {
      hooks.set(server, h)
    },
    forget(server) {
      tokens.delete(server)
      clients.delete(server)
      hooks.delete(server)
    },

    getOAuthTokens(server) {
      return tokens.get(server)
    },
    async saveOAuthTokens(server, t) {
      tokens.set(server, t)
      const h = hooks.get(server)
      if (h?.onTokensChanged) await h.onTokensChanged(t)
    },
    getOAuthClientInfo(server) {
      return clients.get(server)
    },
    async saveOAuthClientInfo(server, c) {
      clients.set(server, c)
      const h = hooks.get(server)
      if (h?.onClientRegistered) await h.onClientRegistered(c)
    },
  }
}
