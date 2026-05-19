import { describe, expect, it, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import {
  isMcpToolsSentinel,
  type McpToolsSentinel,
} from '@electric-ax/agents-mcp'
import { registerHorton, type HortonMcpAllowlist } from '../src/agents/horton'
import type { BuiltinModelCatalog } from '../src/model-catalog'

const modelCatalog: BuiltinModelCatalog = {
  defaultChoice: {
    provider: `anthropic`,
    id: `claude-sonnet-4-6`,
    label: `Anthropic Claude Sonnet 4.6`,
    value: `anthropic:claude-sonnet-4-6`,
    reasoning: true,
  },
  choices: [
    {
      provider: `anthropic`,
      id: `claude-sonnet-4-6`,
      label: `Anthropic Claude Sonnet 4.6`,
      value: `anthropic:claude-sonnet-4-6`,
      reasoning: true,
    },
  ],
}

async function captureToolset(
  mcpAllowlist: HortonMcpAllowlist,
  args: Record<string, unknown> = {}
) {
  const registry = createEntityRegistry()
  registerHorton(registry, {
    workingDirectory: `/tmp`,
    modelCatalog,
    mcpAllowlist,
  })
  const useAgent = vi.fn(() => ({ run: vi.fn(async () => {}) }))
  const fakeCtx = {
    args,
    electricTools: [],
    events: [],
    firstWake: false,
    tags: {},
    db: { collections: { inbox: { toArray: [] } } },
    useContext: vi.fn(),
    useAgent,
    agent: { run: vi.fn(async () => {}) },
  } as any
  await registry
    .get(`horton`)!
    .definition.handler(fakeCtx, { type: `inbox` } as any)
  expect(useAgent).toHaveBeenCalledTimes(1)
  const cfg = (
    useAgent.mock.calls as unknown as Array<[{ tools: Array<unknown> }]>
  )[0]![0]
  return cfg.tools
}

describe(`horton tool composition`, () => {
  it(`always includes the default built-in toolset`, async () => {
    const tools = await captureToolset(`*`)
    const names = tools
      .filter((t) => !isMcpToolsSentinel(t))
      .map((t) => (t as { name: string }).name)
    expect(names).toEqual(
      expect.arrayContaining([
        `bash`,
        `read`,
        `write`,
        `edit`,
        `web_search`,
        `fetch_url`,
        `spawn_worker`,
      ])
    )
  })

  it(`mcpAllowlist: '*' emits an unrestricted MCP sentinel (all servers)`, async () => {
    const tools = await captureToolset(`*`)
    const sentinels = tools.filter(isMcpToolsSentinel) as McpToolsSentinel[]
    expect(sentinels).toHaveLength(1)
    expect(sentinels[0]!.allowlist).toBeUndefined()
  })

  it(`mcpAllowlist: [] emits no MCP sentinel at all`, async () => {
    const tools = await captureToolset([])
    expect(tools.some(isMcpToolsSentinel)).toBe(false)
  })

  it(`mcpAllowlist: ['gmail'] emits a sentinel restricted to that server`, async () => {
    const tools = await captureToolset([`gmail`])
    const sentinels = tools.filter(isMcpToolsSentinel) as McpToolsSentinel[]
    expect(sentinels).toHaveLength(1)
    expect(sentinels[0]!.allowlist).toEqual([`gmail`])
  })

  it(`built-in toolset is unchanged regardless of mcpAllowlist`, async () => {
    const namesFor = async (allowlist: HortonMcpAllowlist) => {
      const tools = await captureToolset(allowlist)
      return tools
        .filter((t) => !isMcpToolsSentinel(t))
        .map((t) => (t as { name: string }).name)
        .sort()
    }
    expect(await namesFor(`*`)).toEqual(await namesFor([]))
    expect(await namesFor(`*`)).toEqual(await namesFor([`gmail`]))
  })
})
