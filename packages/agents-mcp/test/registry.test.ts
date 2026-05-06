import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/registry'
import type { KeyVault } from '../src/vault/types'
import type { McpServerConfig } from '../src/types'
import type { McpTransportHandle } from '../src/transports/types'

const vault: KeyVault = {
  get: async (r) => (r === `vault://github/token` ? `TOKEN` : null),
  set: async () => {},
  delete: async () => {},
  list: async () => [],
}

type GetAuthHeader = () => Promise<{ name: string; value: string } | null>

function fakeFactory(): (
  name: string,
  cfg: McpServerConfig,
  getAuthHeader: GetAuthHeader
) => McpTransportHandle {
  return () => {
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
          listTools: async () => ({
            tools: [{ name: `echo`, description: `echo` }],
          }),
          callTool: async () => ({
            content: [{ type: `text`, text: `ok` }],
          }),
        } as any
      },
    }
  }
}

describe(`registry`, () => {
  it(`registers servers and tracks status`, async () => {
    const reg = createRegistry({ vault, transportFactory: fakeFactory() })
    await reg.applyConfig({
      servers: {
        gh: {
          transport: `http`,
          url: `http://x`,
          auth: {
            mode: `apiKey`,
            headerName: `A`,
            valueRef: `vault://github/token`,
          },
        },
      },
    })
    const list = reg.list()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe(`gh`)
    expect(list[0].status).toBe(`healthy`)
    expect(list[0].tools?.[0].name).toBe(`echo`)
  })

  it(`flips status to needs_auth when token absent`, async () => {
    const reg = createRegistry({ vault, transportFactory: fakeFactory() })
    await reg.applyConfig({
      servers: {
        bad: {
          transport: `http`,
          url: `http://x`,
          auth: {
            mode: `apiKey`,
            headerName: `A`,
            valueRef: `vault://missing`,
          },
        },
      },
    })
    expect(reg.list().find((s) => s.name === `bad`)?.status).toBe(`needs_auth`)
  })

  it(`removes servers no longer in config`, async () => {
    const reg = createRegistry({ vault, transportFactory: fakeFactory() })
    await reg.applyConfig({
      servers: { a: { transport: `stdio`, command: `echo` } },
    })
    expect(reg.list()).toHaveLength(1)
    await reg.applyConfig({ servers: {} })
    expect(reg.list()).toHaveLength(0)
  })

  it(`stdio servers register as healthy`, async () => {
    const reg = createRegistry({ vault, transportFactory: fakeFactory() })
    await reg.applyConfig({
      servers: { s: { transport: `stdio`, command: `echo` } },
    })
    expect(reg.list()[0].status).toBe(`healthy`)
  })

  it(`OAuth modes are needs_auth in v1`, async () => {
    const reg = createRegistry({ vault, transportFactory: fakeFactory() })
    await reg.applyConfig({
      servers: {
        cc: {
          transport: `http`,
          url: `http://x`,
          auth: {
            mode: `clientCredentials`,
            clientIdRef: `a`,
            clientSecretRef: `b`,
            tokenUrl: `http://t`,
          },
        },
        ac: {
          transport: `http`,
          url: `http://x`,
          auth: { mode: `authorizationCode`, flow: `browser` },
        },
      },
    })
    const list = reg.list()
    expect(list.find((s) => s.name === `cc`)?.status).toBe(`needs_auth`)
    expect(list.find((s) => s.name === `ac`)?.status).toBe(`needs_auth`)
  })
})
