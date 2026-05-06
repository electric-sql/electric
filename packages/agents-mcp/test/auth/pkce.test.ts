import { describe, expect, it } from 'vitest'
import { generatePkcePair, codeChallengeS256 } from '../../src/auth/pkce'

describe(`PKCE`, () => {
  it(`verifier is 43-128 url-safe chars`, () => {
    const { verifier } = generatePkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
  })
  it(`challenge matches S256 of verifier`, () => {
    const { verifier, challenge } = generatePkcePair()
    expect(challenge).toBe(codeChallengeS256(verifier))
    expect(challenge).toMatch(/^[A-Za-z0-9\-_]+$/) // base64url, no padding
  })
})
