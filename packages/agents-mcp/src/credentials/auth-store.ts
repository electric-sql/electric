// Internal — do not export from src/index.ts. Instantiated once per
// registry; lives in-process. Cross-process persistence is the operator's
// concern via the hooks declared on the auth config.
import type { OAuthClientInfo, OAuthTokens } from '../types'

/**
 * Internal token + client cache used by the registry. Created per-registry,
 * never crossed by the public API. Seeded from `auth.tokens` / `auth.client`
 * on `addServer`; mutated as the SDK refreshes / completes DCR. Calls into
 * the per-server `onTokensChanged` / `onClientRegistered` callbacks declared
 * on the auth config so the operator can persist if they want.
 */
export interface AuthStore {
  getOAuthTokens(server: string): OAuthTokens | undefined
  saveOAuthTokens(server: string, tokens: OAuthTokens): Promise<void>
  getOAuthClientInfo(server: string): OAuthClientInfo | undefined
  saveOAuthClientInfo(server: string, info: OAuthClientInfo): Promise<void>
}

/** Per-server hooks registered on `addServer` and invoked on cache mutations. */
export interface AuthStoreHooks {
  onTokensChanged?: (tokens: OAuthTokens) => void | Promise<void>
  onClientRegistered?: (client: OAuthClientInfo) => void | Promise<void>
}

export interface InternalAuthStore extends AuthStore {
  /** Pre-seed the cache with tokens read from `auth.tokens`. */
  seedTokens(server: string, tokens: OAuthTokens): void
  /** Pre-seed the cache with a pre-registered OAuth client. */
  seedClient(server: string, client: OAuthClientInfo): void
  /** Register per-server hooks declared on the auth config. */
  registerHooks(server: string, hooks: AuthStoreHooks): void
  /**
   * Drop only the cached tokens + DCR client info for a server. Hooks
   * stay registered, so future `saveOAuthTokens` / `saveOAuthClientInfo`
   * calls still notify the operator's persistence callbacks. Used by
   * `Registry.reauthorize` to force a fresh OAuth flow without losing
   * the persistence wiring.
   */
  clearCredentials(server: string): void
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
    clearCredentials(server) {
      tokens.delete(server)
      clients.delete(server)
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
