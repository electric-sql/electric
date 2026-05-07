// Internal-only. The public OAuthTokens / OAuthClientInfo shapes live in
// `../types`; this file holds the cache contract used by the registry and
// the SDK OAuth provider adapter to manage in-process token state.
import type { OAuthTokens, OAuthClientInfo } from '../types'

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
