import { describe, expect, it } from 'vitest'
import { ClaimWriteTokenStore } from '../src/claim-write-token-store'

describe(`ClaimWriteTokenStore`, () => {
  it(`keeps claim write tokens scoped by tenant and stream`, () => {
    const store = new ClaimWriteTokenStore()
    const streamPath = `/horton/demo/main`

    const tenantAToken = store.mint(`tenant-a`, streamPath, `wake-1`)
    const tenantBToken = store.mint(`tenant-b`, streamPath, `wake-1`)

    expect(tenantAToken).not.toBe(tenantBToken)
    expect(store.isValid(`tenant-a`, streamPath, tenantAToken)).toBe(true)
    expect(store.isValid(`tenant-b`, streamPath, tenantAToken)).toBe(false)
    expect(store.isValid(`tenant-b`, streamPath, tenantBToken)).toBe(true)
  })

  it(`replaces stale claims for the same stream`, () => {
    const store = new ClaimWriteTokenStore()

    const firstToken = store.mint(`tenant-a`, `/one/main`, `wake-1`)
    const secondToken = store.mint(`tenant-a`, `/one/main`, `wake-2`)

    expect(store.isValid(`tenant-a`, `/one/main`, firstToken)).toBe(false)
    expect(store.isValid(`tenant-a`, `/one/main`, secondToken)).toBe(true)
    expect(store.owns(`tenant-a`, `/one/main`, `wake-2`)).toBe(true)
  })

  it(`allows one consumer to hold claims for multiple streams`, () => {
    const store = new ClaimWriteTokenStore()

    const firstToken = store.mint(`tenant-a`, `/one/main`, `runner-1`)
    const secondToken = store.mint(`tenant-a`, `/two/main`, `runner-1`)

    expect(store.isValid(`tenant-a`, `/one/main`, firstToken)).toBe(true)
    expect(store.isValid(`tenant-a`, `/two/main`, secondToken)).toBe(true)
    expect(store.owns(`tenant-a`, `/one/main`, `runner-1`)).toBe(true)
    expect(store.owns(`tenant-a`, `/two/main`, `runner-1`)).toBe(true)
  })

  it(`clears all claims for a consumer`, () => {
    const store = new ClaimWriteTokenStore()

    const firstToken = store.mint(`tenant-a`, `/one/main`, `runner-1`)
    const secondToken = store.mint(`tenant-a`, `/two/main`, `runner-1`)
    const otherToken = store.mint(`tenant-a`, `/three/main`, `runner-2`)

    store.clearConsumer(`tenant-a`, `runner-1`)

    expect(store.isValid(`tenant-a`, `/one/main`, firstToken)).toBe(false)
    expect(store.isValid(`tenant-a`, `/two/main`, secondToken)).toBe(false)
    expect(store.isValid(`tenant-a`, `/three/main`, otherToken)).toBe(true)
  })

  it(`adopts a backend-issued token instead of minting one`, () => {
    const store = new ClaimWriteTokenStore()

    const token = store.mint(`tenant-a`, `/one/main`, `wake-1`, `backend-token`)

    expect(token).toBe(`backend-token`)
    expect(store.isValid(`tenant-a`, `/one/main`, `backend-token`)).toBe(true)
  })

  it(`keeps the previous token valid across a same-consumer refresh`, () => {
    const store = new ClaimWriteTokenStore()

    const first = store.mint(`tenant-a`, `/one/main`, `wake-1`)
    const second = store.mint(`tenant-a`, `/one/main`, `wake-1`)

    expect(store.isValid(`tenant-a`, `/one/main`, first)).toBe(true)
    expect(store.isValid(`tenant-a`, `/one/main`, second)).toBe(true)

    const third = store.mint(`tenant-a`, `/one/main`, `wake-1`)

    expect(store.isValid(`tenant-a`, `/one/main`, first)).toBe(false)
    expect(store.isValid(`tenant-a`, `/one/main`, second)).toBe(true)
    expect(store.isValid(`tenant-a`, `/one/main`, third)).toBe(true)
  })

  it(`evicts the previous token when a different consumer claims the stream`, () => {
    const store = new ClaimWriteTokenStore()

    const first = store.mint(`tenant-a`, `/one/main`, `wake-1`)
    const refreshed = store.mint(`tenant-a`, `/one/main`, `wake-1`)
    const successor = store.mint(`tenant-a`, `/one/main`, `wake-2`)

    expect(store.isValid(`tenant-a`, `/one/main`, first)).toBe(false)
    expect(store.isValid(`tenant-a`, `/one/main`, refreshed)).toBe(false)
    expect(store.isValid(`tenant-a`, `/one/main`, successor)).toBe(true)
  })

  it(`hands a delivered token to exactly one claim`, () => {
    const store = new ClaimWriteTokenStore()

    store.recordDelivered(`tenant-a`, `wake-1`, `backend-token`)

    expect(store.takeDelivered(`tenant-a`, `wake-1`)).toBe(`backend-token`)
    expect(store.takeDelivered(`tenant-a`, `wake-1`)).toBeUndefined()
  })

  it(`scopes delivered tokens by tenant and drops them with the consumer`, () => {
    const store = new ClaimWriteTokenStore()

    store.recordDelivered(`tenant-a`, `wake-1`, `token-a`)
    store.recordDelivered(`tenant-b`, `wake-1`, `token-b`)
    store.clearConsumer(`tenant-a`, `wake-1`)

    expect(store.takeDelivered(`tenant-a`, `wake-1`)).toBeUndefined()
    expect(store.takeDelivered(`tenant-b`, `wake-1`)).toBe(`token-b`)
  })

  describe(`expiry`, () => {
    function clockedStore(ttlMs = 1_000) {
      const clock = { now: 0 }
      return {
        clock,
        store: new ClaimWriteTokenStore({ ttlMs, now: () => clock.now }),
      }
    }

    it(`expires a claim that is neither re-minted nor renewed within the TTL`, () => {
      const { clock, store } = clockedStore()

      const token = store.mint(`tenant-a`, `/one/main`, `wake-1`)
      clock.now = 999
      expect(store.isValid(`tenant-a`, `/one/main`, token)).toBe(true)
      expect(store.owns(`tenant-a`, `/one/main`, `wake-1`)).toBe(true)

      clock.now = 1_000
      expect(store.isValid(`tenant-a`, `/one/main`, token)).toBe(false)
      expect(store.owns(`tenant-a`, `/one/main`, `wake-1`)).toBe(false)
    })

    it(`re-minting and renewing both extend the claim`, () => {
      const { clock, store } = clockedStore()

      const first = store.mint(`tenant-a`, `/one/main`, `wake-1`)
      clock.now = 800
      const second = store.mint(`tenant-a`, `/one/main`, `wake-1`)
      clock.now = 1_500
      expect(store.isValid(`tenant-a`, `/one/main`, first)).toBe(true)
      expect(store.isValid(`tenant-a`, `/one/main`, second)).toBe(true)

      store.renew(`tenant-a`, `wake-1`)
      clock.now = 2_400
      expect(store.isValid(`tenant-a`, `/one/main`, second)).toBe(true)
      expect(store.owns(`tenant-a`, `/one/main`, `wake-1`)).toBe(true)
    })

    it(`expires a delivered token nobody claimed`, () => {
      const { clock, store } = clockedStore()

      store.recordDelivered(`tenant-a`, `wake-1`, `backend-token`)
      store.recordDelivered(`tenant-a`, `wake-2`, `backend-token-2`)
      clock.now = 500
      store.renew(`tenant-a`, `wake-2`)
      clock.now = 1_000

      expect(store.takeDelivered(`tenant-a`, `wake-1`)).toBeUndefined()
      expect(store.takeDelivered(`tenant-a`, `wake-2`)).toBe(`backend-token-2`)
    })

    it(`sweeps expired entries so a later mint by a different consumer starts clean`, () => {
      const { clock, store } = clockedStore()

      const stale = store.mint(`tenant-a`, `/one/main`, `wake-1`)
      store.recordDelivered(`tenant-a`, `wake-1`, `delivered-1`)
      clock.now = 1_000
      // A mint for another stream triggers the sweep; the stale consumer's
      // entries are gone, not merely hidden, so clearing it later is a no-op
      // that cannot touch a successor's claim.
      store.mint(`tenant-a`, `/two/main`, `wake-2`)
      const successor = store.mint(`tenant-a`, `/one/main`, `wake-3`)
      store.clearConsumer(`tenant-a`, `wake-1`)

      expect(store.isValid(`tenant-a`, `/one/main`, stale)).toBe(false)
      expect(store.isValid(`tenant-a`, `/one/main`, successor)).toBe(true)
      expect(store.takeDelivered(`tenant-a`, `wake-1`)).toBeUndefined()
    })
  })
})
