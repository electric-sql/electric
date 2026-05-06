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

describe(`cancellation`, () => {
  it(`aborts the SDK signal on timeout`, async () => {
    const aborts: AbortSignal[] = []
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
            listTools: async () => ({ tools: [] }),
            listResources: async () => ({ resources: [] }),
            listPrompts: async () => ({ prompts: [] }),
            callTool: async (
              _args: unknown,
              _schema: unknown,
              opts?: { signal?: AbortSignal }
            ) => {
              if (opts?.signal) aborts.push(opts.signal)
              return new Promise((_resolve, reject) => {
                opts?.signal?.addEventListener(`abort`, () =>
                  reject(new Error(`aborted`))
                )
              })
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
    const { TimeoutError } = await import(`../src/transports/timeout`)
    await expect(
      reg.invokeMethod(`mock`, `tools/call`, { name: `slow` }, 20)
    ).rejects.toBeInstanceOf(TimeoutError)
    expect(aborts).toHaveLength(1)
    expect(aborts[0].aborted).toBe(true)
  })

  it(`disable closes the transport and flips status`, async () => {
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
    expect(reg.get(`mock`)?.status).toBe(`healthy`)
    reg.disable(`mock`)
    expect(reg.get(`mock`)?.status).toBe(`disabled`)
    reg.enable(`mock`)
    // Re-enabling should flip back, but won't reconnect synchronously; simply unset disabled
    expect(reg.get(`mock`)?.status).not.toBe(`disabled`)
  })

  it(`invokeMethod throws when server is disabled`, async () => {
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
    reg.disable(`mock`)
    await expect(
      reg.invokeMethod(`mock`, `tools/list`, {}, 1000)
    ).rejects.toThrow(/disabled/)
  })
})
