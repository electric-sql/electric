import { describe, expect, it, vi } from 'vitest'
import { bridgeMcpTool, prefixToolName } from '../../src/bridge/tool-bridge'

describe(`prefixToolName`, () => {
  it(`produces mcp__server__tool`, () => {
    expect(prefixToolName(`honeycomb`, `list_datasets`)).toBe(
      `mcp__honeycomb__list_datasets`
    )
  })
  it(`sanitizes server names with disallowed characters`, () => {
    expect(prefixToolName(`foo.bar`, `baz`)).toBe(`mcp__foo_bar__baz`)
  })
  it(`matches Anthropic regex`, () => {
    const re = /^[a-zA-Z0-9_-]{1,128}$/
    expect(re.test(prefixToolName(`honeycomb`, `list_datasets`))).toBe(true)
  })
  it(`truncates names longer than 128 chars while keeping the prefix`, () => {
    const long = `x`.repeat(200)
    const name = prefixToolName(`s`, long)
    expect(name.length).toBeLessThanOrEqual(128)
    expect(name.startsWith(`mcp__s__`)).toBe(true)
  })
})

describe(`bridgeMcpTool`, () => {
  it(`invokes the SDK callTool and returns its result`, async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: `text`, text: `hi` }],
    }))
    const tool = bridgeMcpTool({
      server: `mock`,
      tool: { name: `echo`, description: `d`, inputSchema: { type: `object` } },
      client: { callTool } as any,
      timeoutMs: 1000,
    })
    expect(tool.name).toBe(`mcp__mock__echo`)
    const result = await tool.call({ msg: `hi` })
    expect(callTool).toHaveBeenCalledWith({
      name: `echo`,
      arguments: { msg: `hi` },
    })
    expect(result).toEqual({ content: [{ type: `text`, text: `hi` }] })
  })
  it(`returns a structured timeout error when slower than budget`, async () => {
    const callTool = () =>
      new Promise((r) => setTimeout(() => r({ content: [] }), 50))
    const tool = bridgeMcpTool({
      server: `mock`,
      tool: { name: `slow`, description: `d`, inputSchema: { type: `object` } },
      client: { callTool } as any,
      timeoutMs: 5,
    })
    await expect(tool.call({})).rejects.toMatchObject({ kind: `timeout` })
  })
})
