import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../src/registry'

describe(`Registry`, () => {
  it(`addServer with apiKey but no inline key resolves to error`, async () => {
    const reg = createRegistry({})
    const result = await reg.addServer({
      name: `a`,
      transport: `http`,
      url: `https://example.com/mcp`,
      // @ts-expect-error — purposely missing required `key`
      auth: { mode: `apiKey` },
    })
    expect(result.state).toBe(`error`)
    if (result.state === `error`)
      expect(result.error.kind).toBe(`auth_unavailable`)
  })

  it(`addServer with inline apiKey transitions to ready and lists tools`, async () => {
    const reg = createRegistry({
      transportFactoryOverride: () => makeFakeTransport([`t1`, `t2`]),
    })
    const result = await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: { mode: `apiKey`, key: `KEY` },
    })
    expect(result.state).toBe(`ready`)
    if (result.state === `ready`) expect(result.toolCount).toBe(2)
  })

  it(`applyConfig is idempotent on unchanged config — does not close existing transport`, async () => {
    const closeSpy = vi.fn()
    const reg = createRegistry({
      transportFactoryOverride: () => ({
        ...makeFakeTransport([`t1`]),
        close: closeSpy,
      }),
    })
    const cfg = {
      servers: [
        {
          name: `mock`,
          transport: `http` as const,
          url: `https://mock/mcp`,
          auth: { mode: `apiKey` as const, key: `KEY` },
        },
      ],
      raw: {},
    }
    await reg.applyConfig(cfg)
    await reg.applyConfig(cfg)
    expect(closeSpy).not.toHaveBeenCalled()
  })

  it(`applyConfig with drifted config closes the old transport and opens a new one`, async () => {
    const closeSpy = vi.fn()
    const reg = createRegistry({
      transportFactoryOverride: () => ({
        ...makeFakeTransport([`t1`]),
        close: closeSpy,
      }),
    })
    const v1 = mkCfg(`https://a/mcp`)
    const v2 = mkCfg(`https://b/mcp`)
    await reg.applyConfig(v1)
    await reg.applyConfig(v2)
    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it(`removeServer fully tears down`, async () => {
    const closeSpy = vi.fn()
    const reg = createRegistry({
      transportFactoryOverride: () => ({
        ...makeFakeTransport([`t1`]),
        close: closeSpy,
      }),
    })
    await reg.addServer({
      name: `mock`,
      transport: `http`,
      url: `https://mock/mcp`,
      auth: { mode: `apiKey`, key: `KEY` },
    })
    await reg.removeServer(`mock`)
    expect(closeSpy).toHaveBeenCalled()
    expect(reg.list().length).toBe(0)
  })
})

it(`disable closes the transport and zeroes the tool count; enable restores`, async () => {
  const closeSpy = vi.fn()
  const reg = createRegistry({
    transportFactoryOverride: () => ({
      ...makeFakeTransport([`t1`]),
      close: closeSpy,
    }),
  })
  await reg.addServer({
    name: `mock`,
    transport: `http`,
    url: `https://m/mcp`,
    auth: { mode: `apiKey`, key: `KEY` },
  })
  expect(reg.list()[0]!.status).toBe(`ready`)
  await reg.disable(`mock`)
  expect(closeSpy).toHaveBeenCalled()
  expect(reg.list()[0]!.status).toBe(`disabled`)
  expect(reg.list()[0]!.toolCount).toBe(0)
  const r = await reg.enable(`mock`)
  expect(r.state).toBe(`ready`)
  expect(reg.list()[0]!.status).toBe(`ready`)
})

function mkCfg(url: string) {
  return {
    servers: [
      {
        name: `mock`,
        transport: `http` as const,
        url,
        auth: { mode: `apiKey` as const, key: `KEY` },
      },
    ],
    raw: {},
  }
}

function makeFakeTransport(toolNames: string[]) {
  return {
    client: {
      listTools: async () => ({
        tools: toolNames.map((name) => ({
          name,
          description: name,
          inputSchema: { type: `object` },
        })),
      }),
      callTool: async () => ({ content: [{ type: `text`, text: `ok` }] }),
      close: async () => {},
    } as any,
    connect: async () => {},
    close: async () => {},
  }
}
