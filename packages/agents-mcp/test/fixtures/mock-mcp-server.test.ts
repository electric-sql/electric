import { describe, expect, it } from 'vitest'
import { createMockServer } from './mock-mcp-server'

describe(`mock MCP server (edge-case fixture)`, () => {
  it(`responds to initialize with capabilities`, async () => {
    const srv = createMockServer({ scenario: `auth-required` })
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

  it(`auth-required: tools/call returns Unauthorized`, async () => {
    const srv = createMockServer({ scenario: `auth-required` })
    const res = await srv.handle({
      jsonrpc: `2.0`,
      id: 2,
      method: `tools/call`,
      params: { name: `echo`, arguments: { msg: `hi` } },
    })
    expect(res.error).toMatchObject({ message: `Unauthorized` })
  })

  it(`tools-changed: tools/list returns a different set on the second call`, async () => {
    const srv = createMockServer({ scenario: `tools-changed` })
    const first = await srv.handle({
      jsonrpc: `2.0`,
      id: 3,
      method: `tools/list`,
      params: {},
    })
    const second = await srv.handle({
      jsonrpc: `2.0`,
      id: 4,
      method: `tools/list`,
      params: {},
    })
    const firstNames = first.result.tools.map((t: { name: string }) => t.name)
    const secondNames = second.result.tools.map((t: { name: string }) => t.name)
    expect(firstNames).toContain(`echo`)
    expect(secondNames).toContain(`echo2`)
    expect(firstNames).not.toEqual(secondNames)
  })
})
