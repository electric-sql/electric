import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/registry'
import type { RegistryOpts } from '../src/registry'
import { inMemoryCredentialStore } from '../src/credentials/in-memory'

describe(`Registry — OAuth`, () => {
  it(`authorizationCode without saved tokens returns authenticating + authUrl`, async () => {
    const credentials = inMemoryCredentialStore()
    await credentials.saveOAuthClientInfo?.(`mock`, { clientId: `cid` })
    const opts: RegistryOpts = {
      credentials,
      publicUrl: `http://r:4448`,
      transportFactoryOverride: (cfg, hp, provider) => ({
        client: {
          listTools: async () => ({ tools: [] }),
          close: async () => {},
        } as any,
        connect: async () => {
          provider!.redirectToAuthorization(
            new URL(`https://provider/authorize?x=1`)
          )
          throw new Error(`UnauthorizedError`)
        },
        close: async () => {},
      }),
    }
    const reg = createRegistry(opts)
    const r = await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: {
        mode: `authorizationCode`,
        flow: `browser`,
        scopes: [`mcp:read`],
      },
    })
    expect(r.state).toBe(`authenticating`)
    if (r.state === `authenticating`) expect(r.authUrl).toContain(`authorize`)
  })

  it(`clientCredentials: connects when tokens exchange succeeds`, async () => {
    const credentials = inMemoryCredentialStore()
    credentials.setClientCredentials(`mock`, {
      clientId: `cid`,
      clientSecret: `sec`,
    })
    const opts: RegistryOpts = {
      credentials,
      publicUrl: `http://r:4448`,
      transportFactoryOverride: () => ({
        client: {
          listTools: async () => ({
            tools: [{ name: `t`, inputSchema: {} }],
          }),
          close: async () => {},
        } as any,
        connect: async () => {},
        close: async () => {},
      }),
    }
    const reg = createRegistry(opts)
    const r = await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: { mode: `clientCredentials`, tokenUrl: `https://x/token` },
    })
    expect(r.state).toBe(`ready`)
  })
})
