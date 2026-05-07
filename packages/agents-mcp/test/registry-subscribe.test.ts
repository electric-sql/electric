import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../src/registry'

function fakeTransport(toolNames: string[] = [`t1`]) {
  return {
    client: {
      listTools: async () => ({
        tools: toolNames.map((name) => ({
          name,
          description: name,
          inputSchema: { type: `object` },
        })),
      }),
      callTool: async () => ({ content: [] }),
      close: async () => {},
    } as any,
    connect: async () => {},
    close: async () => {},
  }
}

describe(`Registry — subscribe`, () => {
  it(`fires the handler synchronously with the current snapshot on subscribe`, () => {
    const reg = createRegistry({})
    const handler = vi.fn()
    reg.subscribe(handler)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]![0]).toEqual({ seq: 0, servers: [] })
  })

  it(`fires the handler on every state-changing mutation`, async () => {
    const reg = createRegistry({
      transportFactoryOverride: () => fakeTransport([`alpha`]),
    })
    const handler = vi.fn()
    reg.subscribe(handler)
    handler.mockClear()

    await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: { mode: `apiKey`, key: `KEY` },
    })
    // addServer fires twice: once for `connecting` (entries.set), once
    // for `ready` (connectAndList). The second snapshot must show tools.
    expect(handler.mock.calls.length).toBeGreaterThanOrEqual(1)
    const last = handler.mock.calls[handler.mock.calls.length - 1]![0]
    expect(last.servers).toHaveLength(1)
    expect(last.servers[0]!.status).toBe(`ready`)
    expect(last.servers[0]!.toolCount).toBe(1)

    await reg.removeServer(`mock`)
    const afterRemove = handler.mock.calls[handler.mock.calls.length - 1]![0]
    expect(afterRemove.servers).toHaveLength(0)
  })

  it(`returns an unsubscribe function`, () => {
    const reg = createRegistry({})
    const handler = vi.fn()
    const off = reg.subscribe(handler)
    handler.mockClear()
    off()
    void reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: { mode: `apiKey`, key: `KEY` },
    })
    // The handler shouldn't be invoked again after off().
    // Wait a tick for any pending async notify calls.
    return new Promise((r) => setTimeout(r, 10)).then(() => {
      expect(handler).not.toHaveBeenCalled()
    })
  })

  it(`monotonic seq across snapshots`, async () => {
    const reg = createRegistry({
      transportFactoryOverride: () => fakeTransport([`a`]),
    })
    const seqs: number[] = []
    reg.subscribe((s) => seqs.push(s.seq))
    await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: { mode: `apiKey`, key: `KEY` },
    })
    await reg.removeServer(`mock`)
    // Each value must be strictly greater than the previous one (or equal
    // to 0 for the initial-on-subscribe deliver).
    for (let i = 1; i < seqs.length; i++) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!)
    }
  })

  it(`a late subscriber still receives seq 0 as the bootstrap sentinel`, async () => {
    const reg = createRegistry({
      transportFactoryOverride: () => fakeTransport([`a`]),
    })
    // Drive several mutations before the subscriber attaches; the
    // internal seq counter advances each time a snapshot would have
    // been emitted, but no subscriber means notify() is a no-op.
    await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: { mode: `apiKey`, key: `KEY` },
    })
    await reg.removeServer(`mock`)
    const handler = vi.fn()
    reg.subscribe(handler)
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler.mock.calls[0]![0]!.seq).toBe(0)
  })

  it(`a buggy subscriber does not break the registry`, async () => {
    const reg = createRegistry({
      transportFactoryOverride: () => fakeTransport([`a`]),
    })
    reg.subscribe(() => {
      throw new Error(`oops`)
    })
    // addServer must still complete despite the throwing subscriber.
    const result = await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: { mode: `apiKey`, key: `KEY` },
    })
    expect(result.state).toBe(`ready`)
  })
})
