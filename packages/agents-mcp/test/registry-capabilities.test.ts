import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/registry'

describe(`Registry — capabilities`, () => {
  it(`records the server-advertised capabilities after connect`, async () => {
    const reg = createRegistry({
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
      auth: { mode: `apiKey`, key: `KEY` },
    })
    const entry = reg.get(`mock`)
    expect(entry?.capabilities).toEqual({ resources: {}, prompts: {} })
  })
})
