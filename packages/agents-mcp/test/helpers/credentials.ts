import { createAuthStore } from '../../src/credentials/auth-store'
import type { InternalAuthStore } from '../../src/credentials/auth-store'
import type { OAuthClientInfo, OAuthTokens } from '../../src/types'

/**
 * Test-only auth store with optional seed values. Internal helper —
 * tests pass the result via `createRegistry({ authStore })` (the
 * registry's `@internal` hook) when they need to inspect or mutate
 * the registry's private OAuth cache.
 *
 *   const authStore = testAuthStore({
 *     tokens: { honeycomb: { accessToken: 'old' } },
 *   })
 *   const reg = createRegistry({ authStore })
 *   // ...
 *   expect(authStore.getOAuthTokens('honeycomb')?.accessToken).toBe('NEW')
 *
 * Production callers don't see this — they declare initial state via
 * `auth.tokens` / `auth.client` on the per-server config and persist
 * via the `onTokensChanged` / `onClientRegistered` callbacks.
 */
export interface TestAuthStoreSeed {
  tokens?: Record<string, OAuthTokens>
  clients?: Record<string, OAuthClientInfo>
}

export function testAuthStore(seed: TestAuthStoreSeed = {}): InternalAuthStore {
  const store = createAuthStore()
  for (const [server, t] of Object.entries(seed.tokens ?? {})) {
    store.seedTokens(server, t)
  }
  for (const [server, c] of Object.entries(seed.clients ?? {})) {
    store.seedClient(server, c)
  }
  return store
}
