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
    expect(tool.server).toBe(`mock`)
    const result = await tool.call({ msg: `hi` })
    expect(callTool).toHaveBeenCalledWith({
      name: `echo`,
      arguments: { msg: `hi` },
    })
    expect(result).toEqual({ content: [{ type: `text`, text: `hi` }] })
  })
  it(`normalizes inputSchema with no properties to { properties: {}, required: [] }`, () => {
    const tool = bridgeMcpTool({
      server: `mock`,
      tool: {
        name: `noargs`,
        description: `d`,
        inputSchema: { type: `object` },
      },
      client: { callTool: vi.fn() } as any,
    })
    expect(tool.inputSchema).toEqual({
      type: `object`,
      properties: {},
      required: [],
    })
  })
  it(`leaves a well-formed object schema untouched`, () => {
    const schema = {
      type: `object`,
      properties: { msg: { type: `string` } },
      required: [`msg`],
    }
    const tool = bridgeMcpTool({
      server: `mock`,
      tool: { name: `echo`, description: `d`, inputSchema: schema },
      client: { callTool: vi.fn() } as any,
    })
    expect(tool.inputSchema).toEqual(schema)
  })
  it(`passes signal as the THIRD arg (options) — not the second (resultSchema)`, async () => {
    // Regression: before the fix, invoke() passed { signal } as the second argument
    // to client.callTool(), landing in the resultSchema position. The real MCP SDK
    // then tried safeParse({ signal }, response), which threw
    // "v3Schema.safeParse is not a function".
    const callTool = vi.fn(async () => ({
      content: [{ type: `text`, text: `ok` }],
    }))
    const tool = bridgeMcpTool({
      server: `mock`,
      tool: { name: `echo`, description: `d`, inputSchema: { type: `object` } },
      client: { callTool } as any,
      timeoutMs: 1000,
    })
    const ac = new AbortController()
    await tool.execute(`call-1`, { message: `hi` }, ac.signal)

    // callTool must be called with THREE args:
    //   [0] params  { name, arguments }
    //   [1] undefined  (resultSchema — let the SDK default to CallToolResultSchema)
    //   [2] options { signal, ... }
    expect(callTool).toHaveBeenCalledTimes(1)
    const call = callTool.mock.calls[0] as unknown as [
      unknown,
      unknown,
      { signal?: AbortSignal },
    ]
    const [params, resultSchema, options] = call
    expect(params).toEqual({ name: `echo`, arguments: { message: `hi` } })
    expect(resultSchema).toBeUndefined()
    expect(options).toMatchObject({ signal: ac.signal })
  })

  it(`omits resultSchema/options args entirely when no signal or onProgress`, async () => {
    const callTool = vi.fn(async () => ({
      content: [{ type: `text`, text: `ok` }],
    }))
    const tool = bridgeMcpTool({
      server: `mock`,
      tool: { name: `echo`, description: `d`, inputSchema: { type: `object` } },
      client: { callTool } as any,
      timeoutMs: 1000,
    })
    await tool.call({ message: `hi` })
    // Only one argument — no resultSchema / options pollution
    expect(callTool).toHaveBeenCalledTimes(1)
    const call = callTool.mock.calls[0] as unknown as unknown[]
    expect(call.length).toBe(1)
    expect(call[0]).toEqual({ name: `echo`, arguments: { message: `hi` } })
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
