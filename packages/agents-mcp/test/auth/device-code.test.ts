import { describe, expect, it, vi } from 'vitest'
import { startDeviceFlow } from '../../src/auth/device-code'

describe(`startDeviceFlow`, () => {
  it(`parses device_authorization response`, async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            device_code: `DEV`,
            user_code: `ABCD-EFGH`,
            verification_uri: `https://x/device`,
            expires_in: 600,
            interval: 5,
          })
        )
    )
    const handle = await startDeviceFlow({
      deviceAuthorizationEndpoint: `https://x/device_authorization`,
      tokenEndpoint: `https://x/token`,
      clientId: `cid`,
      scopes: [`mcp:read`],
      fetchImpl,
    })
    expect(handle.userCode).toBe(`ABCD-EFGH`)
    expect(handle.verificationUri).toBe(`https://x/device`)
    expect(handle.interval).toBe(5)
  })

  it(`poll resolves with tokens after success`, async () => {
    let pollCount = 0
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes(`device_authorization`)) {
        return new Response(
          JSON.stringify({
            device_code: `DEV`,
            user_code: `X`,
            verification_uri: `v`,
            expires_in: 600,
            interval: 1,
          })
        )
      }
      pollCount += 1
      if (pollCount < 2) {
        return new Response(
          JSON.stringify({ error: `authorization_pending` }),
          { status: 400 }
        )
      }
      return new Response(
        JSON.stringify({
          access_token: `AT`,
          expires_in: 3600,
          token_type: `Bearer`,
        })
      )
    })
    const handle = await startDeviceFlow({
      deviceAuthorizationEndpoint: `https://x/device_authorization`,
      tokenEndpoint: `https://x/token`,
      clientId: `cid`,
      fetchImpl,
    })
    const tokens = await handle.poll({ intervalMs: 5 })
    expect(tokens.access_token).toBe(`AT`)
  })

  it(`poll rejects on access_denied`, async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes(`device_authorization`)) {
        return new Response(
          JSON.stringify({
            device_code: `DEV`,
            user_code: `X`,
            verification_uri: `v`,
            expires_in: 600,
            interval: 1,
          })
        )
      }
      return new Response(JSON.stringify({ error: `access_denied` }), {
        status: 400,
      })
    })
    const handle = await startDeviceFlow({
      deviceAuthorizationEndpoint: `https://x/device_authorization`,
      tokenEndpoint: `https://x/token`,
      clientId: `cid`,
      fetchImpl,
    })
    await expect(handle.poll({ intervalMs: 5 })).rejects.toThrow(
      /access_denied/
    )
  })
})
