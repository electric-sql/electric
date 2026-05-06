import { describe, expect, it } from 'vitest'
import { createMockServer } from './mock-mcp-server'

describe(`mock MCP server`, () => {
  it(`responds to initialize with capabilities`, async () => {
    const srv = createMockServer({ scenario: `default` })
    const res = await srv.handle({
      jsonrpc: `2.0`,
      id: 1,
      method: `initialize`,
      params: {
        protocolVersion: `2024-11-05`,
        capabilities: {},
        clientInfo: { name: `test`, version: `0` },
      },
    })
    expect(res.result.capabilities.tools).toBeDefined()
  })

  it(`lists tools`, async () => {
    const srv = createMockServer({ scenario: `default` })
    const res = await srv.handle({
      jsonrpc: `2.0`,
      id: 2,
      method: `tools/list`,
      params: {},
    })
    expect(res.result.tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: `echo` })])
    )
  })

  it(`echoes tools/call`, async () => {
    const srv = createMockServer({ scenario: `default` })
    const res = await srv.handle({
      jsonrpc: `2.0`,
      id: 3,
      method: `tools/call`,
      params: { name: `echo`, arguments: { msg: `hi` } },
    })
    expect(res.result.content[0]).toEqual({ type: `text`, text: `hi` })
  })

  it(`emits progress notifications when scenario=progress`, async () => {
    const srv = createMockServer({ scenario: `progress` })
    const events: Array<{ method: string; params?: unknown }> = []
    srv.onNotification = (n) => events.push(n)
    await srv.handle({
      jsonrpc: `2.0`,
      id: 4,
      method: `tools/call`,
      params: { name: `long`, arguments: {}, _meta: { progressToken: `p1` } },
    })
    expect(events.some((e) => e.method === `notifications/progress`)).toBe(true)
  })
})
