import { describe, expect, it } from 'vitest'
import { createPendingAuthStore } from '../../src/auth/pending-auth'

describe(`pending-auth store`, () => {
  it(`stores and consumes by state`, () => {
    const store = createPendingAuthStore({ ttlMs: 600_000 })
    store.put({
      state: `s1`,
      server: `github`,
      verifier: `v1`,
      clientId: `cid`,
      tokenUrl: `http://t`,
      redirectUri: `http://cb`,
    })
    const v = store.consume(`s1`)
    expect(v?.verifier).toBe(`v1`)
    expect(store.consume(`s1`)).toBeUndefined() // consumed
  })

  it(`expires after TTL`, () => {
    let t = 1
    const store = createPendingAuthStore({
      ttlMs: 1,
      now: () => t,
    })
    store.put({
      state: `s`,
      server: `s`,
      verifier: `v`,
      clientId: `c`,
      tokenUrl: `t`,
      redirectUri: `r`,
    })
    t = 100
    expect(store.consume(`s`)).toBeUndefined()
  })
})
