import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/registry'
import { inMemoryCredentialStore } from '../src/credentials/in-memory'

describe(`Registry — capabilities`, () => {
  it(`records the server-advertised capabilities after connect`, async () => {
    const credentials = inMemoryCredentialStore()
    credentials.setApiKey(`mock`, `KEY`)
    const reg = createRegistry({
      credentials,
      transportFactoryOverride: () => ({
        client: {
          listTools: async () => ({ tools: [] }),
          getServerCapabilities: () => ({ resources: {}, prompts: {} }),
          callTool: async () => ({ content: [] }),
          close: async () => {},
        } as any,
        connect: async () => {},
        close: async () => {},
      }),
    })
    await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: { mode: `apiKey` },
    })
    const entry = reg.get(`mock`)
    expect(entry?.capabilities).toEqual({ resources: {}, prompts: {} })
  })
})
