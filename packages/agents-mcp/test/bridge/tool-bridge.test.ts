import { describe, expect, it } from 'vitest'
import { bridgeMcpTool } from '../../src/bridge/tool-bridge'

describe(`bridgeMcpTool`, () => {
  it(`prefixes name and forwards args`, async () => {
    const calls: any[] = []
    const tool = bridgeMcpTool({
      server: `github`,
      tool: { name: `create_issue`, description: `create` },
      invoke: async (s, t, a, tm) => {
        calls.push({ s, t, a, tm })
        return { ok: true }
      },
      timeoutMs: 30_000,
    })
    expect(tool.name).toBe(`github.create_issue`)
    const result = await tool.run({ repo: `foo` })
    expect(result).toEqual({ ok: true })
    expect(calls[0]).toEqual({
      s: `github`,
      t: `create_issue`,
      a: { repo: `foo` },
      tm: 30_000,
    })
  })

  it(`maps timeout to structured error`, async () => {
    const tool = bridgeMcpTool({
      server: `gh`,
      tool: { name: `x` },
      invoke: async () => {
        const { TimeoutError } = await import(`../../src/transports/timeout`)
        throw new TimeoutError(30)
      },
      timeoutMs: 30,
    })
    const r = await tool.run({})
    expect(r).toEqual({ error: { kind: `timeout`, server: `gh`, ms: 30 } })
  })
})
