import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TokenStore } from '../src/auth/token-store'

describe(`TokenStore`, () => {
  let workDir: string
  let store: TokenStore

  beforeEach(() => {
    workDir = join(tmpdir(), `agents-mcp-token-${randomUUID()}`)
    mkdirSync(workDir, { recursive: true })
    store = new TokenStore(workDir)
  })

  afterEach(() => {
    rmSync(workDir, { recursive: true, force: true })
  })

  it(`returns undefined when no tokens exist`, () => {
    expect(store.getTokens(`honeycomb`)).toBeUndefined()
  })

  it(`saves and reads tokens`, () => {
    const tokens = {
      access_token: `abc`,
      refresh_token: `def`,
      expires_at: 9999999999,
      token_type: `Bearer` as const,
    }
    store.saveTokens(`honeycomb`, tokens)
    const loaded = store.getTokens(`honeycomb`)
    expect(loaded).toEqual(tokens)
  })

  it(`stores tokens for multiple servers independently`, () => {
    store.saveTokens(`a`, { access_token: `1`, token_type: `Bearer` as const })
    store.saveTokens(`b`, { access_token: `2`, token_type: `Bearer` as const })
    expect(store.getTokens(`a`)!.access_token).toBe(`1`)
    expect(store.getTokens(`b`)!.access_token).toBe(`2`)
  })

  it(`removes tokens for a server`, () => {
    store.saveTokens(`x`, { access_token: `t`, token_type: `Bearer` as const })
    store.removeTokens(`x`)
    expect(store.getTokens(`x`)).toBeUndefined()
  })

  it(`saves and reads code verifier`, () => {
    store.saveCodeVerifier(`honeycomb`, `verifier123`)
    expect(store.getCodeVerifier(`honeycomb`)).toBe(`verifier123`)
  })

  it(`saves and reads client info`, () => {
    const info = { client_id: `cid`, client_secret: `csec` }
    store.saveClientInfo(`honeycomb`, info)
    expect(store.getClientInfo(`honeycomb`)).toEqual(info)
  })
})
