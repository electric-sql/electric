import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/registry'
import type { McpTransportHandle } from '../src/transports/types'
import type { KeyVault } from '../src/vault/types'

const vault: KeyVault = {
  get: async () => null,
  set: async () => {},
  delete: async () => {},
  list: async () => [],
}

describe(`capability checks`, () => {
  it(`flags server without tools capability as error`, async () => {
    const fake: () => McpTransportHandle = () => {
      let connected = false
      return {
        async connect() {
          connected = true
        },
        async close() {
          connected = false
        },
        get client() {
          if (!connected) return null
          return {
            getServerCapabilities: () => ({ resources: {} }), // no tools
            listTools: async () => ({ tools: [] }),
            listResources: async () => ({ resources: [] }),
            listPrompts: async () => ({ prompts: [] }),
            setNotificationHandler: () => {},
          } as any
        },
      }
    }
    const reg = createRegistry({ vault, transportFactory: fake })
    await reg.applyConfig({
      servers: { mock: { transport: `stdio`, command: `echo` } },
    })
    const e = reg.get(`mock`)
    expect(e?.status).toBe(`error`)
    expect(e?.lastError).toMatch(/tools/)
  })

  it(`accepts server with tools capability`, async () => {
    const fake: () => McpTransportHandle = () => {
      let connected = false
      return {
        async connect() {
          connected = true
        },
        async close() {
          connected = false
        },
        get client() {
          if (!connected) return null
          return {
            getServerCapabilities: () => ({
              tools: {},
              resources: {},
              prompts: {},
            }),
            listTools: async () => ({ tools: [{ name: `echo` }] }),
            listResources: async () => ({ resources: [] }),
            listPrompts: async () => ({ prompts: [] }),
            setNotificationHandler: () => {},
          } as any
        },
      }
    }
    const reg = createRegistry({ vault, transportFactory: fake })
    await reg.applyConfig({
      servers: { mock: { transport: `stdio`, command: `echo` } },
    })
    const e = reg.get(`mock`)
    expect(e?.status).toBe(`healthy`)
    expect(e?.tools?.[0].name).toBe(`echo`)
  })

  it(`tolerates missing resources/prompts capabilities (no error)`, async () => {
    const fake: () => McpTransportHandle = () => {
      let connected = false
      return {
        async connect() {
          connected = true
        },
        async close() {
          connected = false
        },
        get client() {
          if (!connected) return null
          return {
            getServerCapabilities: () => ({ tools: {} }), // tools only
            listTools: async () => ({ tools: [{ name: `echo` }] }),
            listResources: async () => {
              throw new Error(`should not be called`)
            },
            listPrompts: async () => {
              throw new Error(`should not be called`)
            },
            setNotificationHandler: () => {},
          } as any
        },
      }
    }
    const reg = createRegistry({ vault, transportFactory: fake })
    await reg.applyConfig({
      servers: { mock: { transport: `stdio`, command: `echo` } },
    })
    const e = reg.get(`mock`)
    expect(e?.status).toBe(`healthy`)
    expect(e?.tools?.[0].name).toBe(`echo`)
    expect(e?.resources).toBeUndefined()
    expect(e?.prompts).toBeUndefined()
  })

  it(`flags server that does not declare capabilities`, async () => {
    const fake: () => McpTransportHandle = () => {
      let connected = false
      return {
        async connect() {
          connected = true
        },
        async close() {
          connected = false
        },
        get client() {
          if (!connected) return null
          return {
            getServerCapabilities: () => undefined,
            listTools: async () => ({ tools: [] }),
            listResources: async () => ({ resources: [] }),
            listPrompts: async () => ({ prompts: [] }),
            setNotificationHandler: () => {},
          } as any
        },
      }
    }
    const reg = createRegistry({ vault, transportFactory: fake })
    await reg.applyConfig({
      servers: { mock: { transport: `stdio`, command: `echo` } },
    })
    const e = reg.get(`mock`)
    expect(e?.status).toBe(`error`)
    expect(e?.lastError).toMatch(/capabilities/)
  })
})
