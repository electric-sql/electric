import { describe, expect, it, vi } from 'vitest'
import { createEntityRegistry } from '@electric-ax/agents-runtime'
import {
  isMcpToolsSentinel,
  type McpToolsSentinel,
} from '@electric-ax/agents-mcp'
import { registerHorton } from '../src/agents/horton'
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

// Characterization: Horton today builds a fixed built-in toolset and
// unconditionally appends `...mcp.tools()` — every registered MCP server,
// no allowlist (`horton.ts:396`). The tests below capture that composition
// so a follow-up PR can flip MCP to an opt-in allowlist with a one-line
// expectation change.
async function captureToolset(args: Record<string, unknown> = {}) {
  const registry = createEntityRegistry()
  registerHorton(registry, { workingDirectory: `/tmp`, modelCatalog })
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
  it(`includes the default built-in toolset`, async () => {
    const tools = await captureToolset()
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

  it(`appends an unconditional MCP tools sentinel with no allowlist`, async () => {
    const tools = await captureToolset()
    const sentinels = tools.filter(isMcpToolsSentinel) as McpToolsSentinel[]
    expect(sentinels).toHaveLength(1)
    expect(sentinels[0]!.allowlist).toBeUndefined()
  })

  it(`MCP sentinel is present regardless of args`, async () => {
    const withArgs = await captureToolset({
      model: `anthropic:claude-sonnet-4-6`,
    })
    expect(withArgs.some(isMcpToolsSentinel)).toBe(true)
  })
})
