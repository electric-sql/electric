import { describe, expect, it } from 'vitest'
import { createRegistry } from '../src/registry'
import type { McpServerConfig } from '../src/types'
import type { McpTransportHandle } from '../src/transports/types'
import type { KeyVault } from '../src/vault/types'
import type { ProgressEvent } from '../src/types'

const vault: KeyVault = {
  get: async () => null,
  set: async () => {},
  delete: async () => {},
  list: async () => [],
}

type GetAuthHeader = () => Promise<{ name: string; value: string } | null>

interface FakeState {
  notificationHandler?: (notif: {
    method: string
    params: {
      progressToken: string | number
      progress: number
      total?: number
      message?: string
    }
  }) => void
  lastCallArgs?: {
    name: string
    arguments?: Record<string, unknown>
    _meta?: { progressToken?: string | number }
  }
}

function fakeFactory(
  state: FakeState
): (
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
          listTools: async () => ({ tools: [{ name: `echo` }] }),
          listResources: async () => ({ resources: [] }),
          listPrompts: async () => ({ prompts: [] }),
          callTool: async (args: {
            name: string
            arguments?: Record<string, unknown>
            _meta?: { progressToken?: string | number }
          }) => {
            state.lastCallArgs = args
            if (
              state.notificationHandler &&
              args._meta?.progressToken !== undefined
            ) {
              for (let i = 1; i <= 3; i++) {
                state.notificationHandler({
                  method: `notifications/progress`,
                  params: {
                    progressToken: args._meta.progressToken,
                    progress: i,
                    total: 3,
                  },
                })
              }
            }
            return { content: [{ type: `text`, text: `done` }] }
          },
          setNotificationHandler: (
            _schema: unknown,
            handler: (n: {
              method: string
              params: {
                progressToken: string | number
                progress: number
                total?: number
                message?: string
              }
            }) => void
          ) => {
            state.notificationHandler = handler
          },
        } as any
      },
    }
  }
}

describe(`progress passthrough`, () => {
  it(`emits progress events to subscribers with server name and token`, async () => {
    const state: FakeState = {}
    const reg = createRegistry({ vault, transportFactory: fakeFactory(state) })
    const events: ProgressEvent[] = []
    reg.subscribeToProgress((e) => events.push(e))
    await reg.applyConfig({
      servers: { mock: { transport: `stdio`, command: `echo` } },
    })
    await reg.invokeMethod(
      `mock`,
      `tools/call`,
      { name: `echo`, arguments: {} },
      5_000
    )
    expect(events.length).toBe(3)
    expect(events.every((e) => e.server === `mock`)).toBe(true)
    expect(events[2].progress).toBe(3)
    expect(events[2].total).toBe(3)
    // progressToken should match what the registry injected
    const token = state.lastCallArgs?._meta?.progressToken
    expect(token).toBeDefined()
    expect(events.every((e) => e.progressToken === token)).toBe(true)
  })

  it(`unsubscribe stops events`, async () => {
    const state: FakeState = {}
    const reg = createRegistry({ vault, transportFactory: fakeFactory(state) })
    const events: ProgressEvent[] = []
    const unsubscribe = reg.subscribeToProgress((e) => events.push(e))
    await reg.applyConfig({
      servers: { mock: { transport: `stdio`, command: `echo` } },
    })
    unsubscribe()
    await reg.invokeMethod(
      `mock`,
      `tools/call`,
      { name: `echo`, arguments: {} },
      5_000
    )
    expect(events.length).toBe(0)
  })

  it(`generates a unique progressToken per tools/call`, async () => {
    const state: FakeState = {}
    const reg = createRegistry({ vault, transportFactory: fakeFactory(state) })
    await reg.applyConfig({
      servers: { mock: { transport: `stdio`, command: `echo` } },
    })
    await reg.invokeMethod(
      `mock`,
      `tools/call`,
      { name: `echo`, arguments: {} },
      5_000
    )
    const t1 = state.lastCallArgs?._meta?.progressToken
    await reg.invokeMethod(
      `mock`,
      `tools/call`,
      { name: `echo`, arguments: {} },
      5_000
    )
    const t2 = state.lastCallArgs?._meta?.progressToken
    expect(t1).toBeDefined()
    expect(t2).toBeDefined()
    expect(t1).not.toBe(t2)
  })
})
