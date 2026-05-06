import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../src/registry'
import { inMemoryCredentialStore } from '../src/credentials/in-memory'

describe(`Registry — device flow`, () => {
  it(`addServer with device flow returns user code (envelope-only assertion)`, async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes(`device_authorization`)) {
        return new Response(
          JSON.stringify({
            device_code: `DEV`,
            user_code: `CODE-1234`,
            verification_uri: `https://x/device`,
            expires_in: 600,
            interval: 0,
          })
        )
      }
      return new Response(JSON.stringify({ error: `authorization_pending` }), {
        status: 400,
      })
    })
    const credentials = inMemoryCredentialStore()
    credentials.setClientCredentials(`mock`, {
      clientId: `cid`,
      clientSecret: `sec`,
    })
    const reg = createRegistry({
      credentials,
      publicUrl: `http://r:4448`,
      deviceFlowFetch: fetchImpl,
    })
    const r = await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: {
        mode: `authorizationCode`,
        flow: `device`,
        scopes: [`mcp:read`],
        // @ts-expect-error — extension for device flow
        deviceEndpoints: {
          deviceAuthorizationEndpoint: `https://x/device_authorization`,
          tokenEndpoint: `https://x/token`,
        },
      },
    })
    expect(r.state).toBe(`authenticating`)
    if (r.state === `authenticating`) {
      expect(r.deviceCode?.userCode).toBe(`CODE-1234`)
      expect(r.authUrl).toBe(`https://x/device`)
    }
    await reg.removeServer(`mock`)
  })
})
