import { describe, expect, it, vi } from 'vitest'
import { startDeviceFlow, pollDeviceFlow } from '../../src/auth/device-code'

describe(`device flow`, () => {
  it(`startDeviceFlow returns user_code + verification_uri`, async () => {
    const f = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        device_code: `d`,
        user_code: `ABCD-1234`,
        verification_uri: `http://x`,
        interval: 5,
        expires_in: 600,
      }),
    })) as unknown as typeof globalThis.fetch
    const r = await startDeviceFlow({
      deviceAuthorizationUrl: `http://x/device`,
      clientId: `c`,
      scopes: [`s`],
      fetch: f,
    })
    expect(r.userCode).toBe(`ABCD-1234`)
    expect(r.deviceCode).toBe(`d`)
  })

  it(`pollDeviceFlow handles authorization_pending and slow_down`, async () => {
    let calls = 0
    const f = vi.fn(async () => {
      calls++
      if (calls === 1)
        return {
          ok: false,
          json: async () => ({ error: `authorization_pending` }),
        } as Response
      if (calls === 2)
        return {
          ok: false,
          json: async () => ({ error: `slow_down` }),
        } as Response
      return {
        ok: true,
        json: async () => ({ access_token: `AT`, expires_in: 3600 }),
      } as Response
    }) as unknown as typeof globalThis.fetch
    const tok = await pollDeviceFlow({
      tokenUrl: `http://t`,
      clientId: `c`,
      deviceCode: `d`,
      intervalSec: 0, // 0 to make test fast
      expiresAt: new Date(Date.now() + 60_000),
      fetch: f,
    })
    expect(tok.accessToken).toBe(`AT`)
    expect(calls).toBe(3)
  })
})
