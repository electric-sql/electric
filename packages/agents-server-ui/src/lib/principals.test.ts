import { describe, expect, it } from 'vitest'
import {
  principalKeyFromInput,
  principalUrlFromKey,
  userIdFromPrincipal,
  userPrincipalUrl,
} from './principals'

describe(`principal helpers`, () => {
  it(`normalizes raw principal keys and encoded principal URLs`, () => {
    expect(principalKeyFromInput(`user:abc123`)).toBe(`user:abc123`)
    expect(principalKeyFromInput(`/principal/user%3Aabc123`)).toBe(
      `user:abc123`
    )
    expect(principalKeyFromInput(`/principal/user:abc123`)).toBe(`user:abc123`)
  })

  it(`builds canonical user principal URLs`, () => {
    expect(userPrincipalUrl(`abc123`)).toBe(`/principal/user%3Aabc123`)
    expect(principalUrlFromKey(`user:abc123`)).toBe(`/principal/user%3Aabc123`)
  })

  it(`extracts user ids from raw keys and principal URLs`, () => {
    expect(userIdFromPrincipal(`user:abc123`)).toBe(`abc123`)
    expect(userIdFromPrincipal(`/principal/user%3Aabc123`)).toBe(`abc123`)
    expect(userIdFromPrincipal(`system:dev-local`)).toBe(null)
  })
})
