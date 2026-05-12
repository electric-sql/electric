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

  it(`replaces stale claims for the same stream or consumer`, () => {
    const store = new ClaimWriteTokenStore()

    const firstToken = store.mint(`tenant-a`, `/one/main`, `wake-1`)
    const secondToken = store.mint(`tenant-a`, `/one/main`, `wake-2`)
    const thirdToken = store.mint(`tenant-a`, `/two/main`, `wake-2`)

    expect(store.isValid(`tenant-a`, `/one/main`, firstToken)).toBe(false)
    expect(store.isValid(`tenant-a`, `/one/main`, secondToken)).toBe(false)
    expect(store.isValid(`tenant-a`, `/two/main`, thirdToken)).toBe(true)
    expect(store.owns(`tenant-a`, `/two/main`, `wake-2`)).toBe(true)
  })
})
