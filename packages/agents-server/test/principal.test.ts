import { describe, expect, it } from 'vitest'
import {
  getPrincipalFromRequest,
  parsePrincipalUrl,
  parsePrincipalKey,
  principalUrl,
} from '../src/principal.js'

describe(`principal parser`, () => {
  for (const key of [
    `user:kyle`,
    `agent:ci-bot`,
    `service:github`,
    `system:framework`,
    `system:dev-local`,
  ]) {
    it(`parses ${key}`, () => {
      const principal = parsePrincipalKey(key)
      expect(principal.key).toBe(key)
      const url = `/principal/${encodeURIComponent(key)}`
      expect(principal.url).toBe(url)
      expect(principalUrl(key)).toBe(url)
      expect(parsePrincipalUrl(url)?.key).toBe(key)
    })
  }

  it(`allows additional colons in id`, () => {
    const principal = parsePrincipalKey(`user:clerk:user_123`)
    expect(principal.id).toBe(`clerk:user_123`)
    expect(principal.url).toBe(`/principal/user%3Aclerk%3Auser_123`)
  })

  it(`encodes URL-unsafe principal ids canonically`, () => {
    const principal = parsePrincipalKey(`user:alice@example.com`)
    expect(principal.url).toBe(`/principal/user%3Aalice%40example.com`)
    expect(parsePrincipalUrl(principal.url)?.key).toBe(`user:alice@example.com`)
    expect(parsePrincipalUrl(`/principal/user:alice@example.com`)?.key).toBe(
      `user:alice@example.com`
    )
  })

  it(`rejects invalid keys`, () => {
    for (const key of [`userkyle`, `user:`, `user:/kyle`, `admin:kyle`]) {
      expect(() => parsePrincipalKey(key)).toThrow()
    }
  })

  it(`ignores malformed principal request headers`, () => {
    const request = new Request(`http://server`, {
      headers: { 'electric-principal': `not-a-principal` },
    })

    expect(getPrincipalFromRequest(request)).toBeNull()
  })
})
