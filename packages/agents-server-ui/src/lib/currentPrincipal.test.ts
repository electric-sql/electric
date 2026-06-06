import { describe, expect, it } from 'vitest'
import {
  UNAUTHENTICATED_CLOUD_PRINCIPAL,
  resolveCurrentPrincipal,
} from './currentPrincipal'

describe(`resolveCurrentPrincipal`, () => {
  it(`uses the signed-in Cloud user for Cloud servers over stale configured principals`, () => {
    expect(
      resolveCurrentPrincipal({
        activeServerIsCloud: true,
        cloudUserId: `69691edf-b925-4745-9c34-d7082eeb93e9`,
        configuredPrincipal: `/principal/user%3Ae5736358-3d50-44c2-ba5c-598fc2743297`,
        fallbackPrincipal: `/principal/system%3Adev-local`,
      })
    ).toBe(`/principal/user%3A69691edf-b925-4745-9c34-d7082eeb93e9`)
  })

  it(`does not fall back to dev-local for Cloud servers without a signed-in user`, () => {
    expect(
      resolveCurrentPrincipal({
        activeServerIsCloud: true,
        cloudUserId: null,
        configuredPrincipal: `/principal/user%3Astale`,
        fallbackPrincipal: `/principal/system%3Adev-local`,
      })
    ).toBe(UNAUTHENTICATED_CLOUD_PRINCIPAL)
  })

  it(`uses configured principals for non-Cloud servers`, () => {
    expect(
      resolveCurrentPrincipal({
        activeServerIsCloud: false,
        cloudUserId: `69691edf-b925-4745-9c34-d7082eeb93e9`,
        configuredPrincipal: `/principal/system%3Adev-local`,
        fallbackPrincipal: `/principal/system%3Aother`,
      })
    ).toBe(`/principal/system%3Adev-local`)
  })
})
