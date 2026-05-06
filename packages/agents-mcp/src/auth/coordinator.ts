import type { TokenSet } from './client-credentials'

export class AuthUnavailableError extends Error {
  constructor(
    public server: string,
    public detail: string
  ) {
    super(`auth unavailable for ${server}: ${detail}`)
    this.name = `AuthUnavailableError`
  }
}

export interface TokenCache {
  get(server: string, scopeKey: string): TokenSet | undefined
  set(server: string, scopeKey: string, t: TokenSet): void
}

export interface OAuthCoordinator {
  getToken(server: string, scopes: string[] | undefined): Promise<string>
  setToken(server: string, scopes: string[] | undefined, t: TokenSet): void
}

export interface CoordinatorOpts {
  doRefresh: (
    server: string,
    scopes: string[] | undefined,
    cached: TokenSet | undefined
  ) => Promise<TokenSet>
  cache: TokenCache
}

const REFRESH_SKEW_MS = 30_000

export function createOAuthCoordinator(
  opts: CoordinatorOpts
): OAuthCoordinator {
  const inflight = new Map<string, Promise<TokenSet>>()
  const scopeKey = (s: string[] | undefined) =>
    s?.slice().sort().join(` `) ?? ``

  return {
    async getToken(server, scopes) {
      const sk = scopeKey(scopes)
      const key = `${server}::${sk}`
      const cached = opts.cache.get(server, sk)
      if (cached && cached.expiresAt.getTime() > Date.now() + REFRESH_SKEW_MS) {
        return cached.accessToken
      }
      let p = inflight.get(key)
      if (!p) {
        p = (async () => {
          try {
            const t = await opts.doRefresh(server, scopes, cached)
            opts.cache.set(server, sk, t)
            return t
          } catch (err) {
            throw new AuthUnavailableError(
              server,
              err instanceof Error ? err.message : String(err)
            )
          }
        })()
        inflight.set(key, p)
        // Always remove from inflight when done (success or fail).
        p.catch(() => {}).finally(() => inflight.delete(key))
      }
      const t = await p
      return t.accessToken
    },
    setToken(server, scopes, t) {
      opts.cache.set(server, scopeKey(scopes), t)
    },
  }
}

// Helper: simple in-memory cache.
export function createInMemoryTokenCache(): TokenCache {
  const map = new Map<string, TokenSet>()
  const k = (s: string, sk: string) => `${s}::${sk}`
  return {
    get: (s, sk) => map.get(k(s, sk)),
    set: (s, sk, t) => {
      map.set(k(s, sk), t)
    },
  }
}
