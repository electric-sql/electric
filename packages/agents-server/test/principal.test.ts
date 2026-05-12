import { describe, expect, it } from 'vitest'
import {
  parsePrincipalKey,
  principalKeyFromUrl,
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
      expect(principal.url).toBe(`/principal/${key}`)
      expect(principalUrl(key)).toBe(`/principal/${key}`)
      expect(principalKeyFromUrl(`/principal/${key}`)).toBe(key)
    })
  }

  it(`allows additional colons in id`, () => {
    expect(parsePrincipalKey(`user:clerk:user_123`).id).toBe(`clerk:user_123`)
  })

  it(`rejects invalid keys`, () => {
    for (const key of [`userkyle`, `user:`, `user:/kyle`, `admin:kyle`]) {
      expect(() => parsePrincipalKey(key)).toThrow()
    }
  })
})
