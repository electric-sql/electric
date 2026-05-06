export interface PendingAuth {
  state: string
  server: string
  verifier: string
  clientId: string
  tokenUrl: string
  redirectUri: string
  insertedAt?: number
}

export interface PendingAuthStore {
  put(p: PendingAuth): void
  consume(state: string): PendingAuth | undefined
}

export function createPendingAuthStore(opts: {
  ttlMs: number
  now?: () => number
}): PendingAuthStore {
  const now = opts.now ?? (() => Date.now())
  const map = new Map<string, PendingAuth>()
  return {
    put(p) {
      map.set(p.state, { ...p, insertedAt: now() })
    },
    consume(state) {
      const v = map.get(state)
      if (!v) return undefined
      map.delete(state)
      if (v.insertedAt && now() - v.insertedAt > opts.ttlMs) return undefined
      return v
    },
  }
}
