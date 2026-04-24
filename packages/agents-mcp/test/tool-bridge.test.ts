import { describe, expect, it, vi } from 'vitest'
import { bridgeMcpTools, truncateOutput } from '../src/bridge/tool-bridge'
import type { McpDiscoveredTool } from '../src/types'

describe(`bridgeMcpTools`, () => {
  const mockPool = {
    acquire: vi.fn().mockResolvedValue({
      callTool: vi.fn().mockResolvedValue({
        content: [{ type: `text`, text: `result` }],
        isError: false,
      }),
    }),
    release: vi.fn(),
  }

  const tools: McpDiscoveredTool[] = [
    {
      name: `create_issue`,
      description: `Create a GitHub issue`,
      inputSchema: {
        type: `object`,
        properties: { title: { type: `string` } },
      },
    },
  ]

  it(`creates AgentTools with mcp__ prefix`, () => {
    const bridged = bridgeMcpTools(`github`, tools, mockPool as any, {})
    expect(bridged).toHaveLength(1)
    expect(bridged[0]!.name).toBe(`mcp__github__create_issue`)
    expect(bridged[0]!.label).toBe(`create_issue`)
    expect(bridged[0]!.description).toBe(`Create a GitHub issue`)
  })

  it(`calls the correct MCP tool name (without prefix)`, async () => {
    const bridged = bridgeMcpTools(`github`, tools, mockPool as any, {})
    await bridged[0]!.execute(`call-1`, { title: `Bug` })

    const client = await mockPool.acquire.mock.results[0]!.value
    expect(client.callTool).toHaveBeenCalledWith(`create_issue`, {
      title: `Bug`,
    })
    expect(mockPool.release).toHaveBeenCalledWith(`github`)
  })

  it(`releases pool even on error`, async () => {
    const failPool = {
      acquire: vi.fn().mockResolvedValue({
        callTool: vi.fn().mockRejectedValue(new Error(`fail`)),
      }),
      release: vi.fn(),
    }
    const bridged = bridgeMcpTools(`s`, tools, failPool as any, {})
    await expect(bridged[0]!.execute(`c`, {})).rejects.toThrow(`fail`)
    expect(failPool.release).toHaveBeenCalledWith(`s`)
  })
})

describe(`truncateOutput`, () => {
  it(`returns content unchanged when under limit`, () => {
    const result = truncateOutput(
      { content: [{ type: `text`, text: `short` }], details: {} },
      100
    )
    expect((result.content[0] as any).text).toBe(`short`)
  })

  it(`truncates text content exceeding limit`, () => {
    const longText = `x`.repeat(200)
    const result = truncateOutput(
      { content: [{ type: `text`, text: longText }], details: {} },
      100
    )
    const text = (result.content[0] as any).text as string
    expect(text.length).toBeLessThan(250)
    expect(text).toContain(`[Output truncated`)
  })
})
