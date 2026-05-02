import { describe, expect, it, vi } from 'vitest'
import { createForkCodingAgentTool } from '../../src/tools/fork-coding-agent'

describe(`fork_coding_agent tool`, () => {
  it(`spawns a new coding-agent with fromAgentId`, async () => {
    const spawn = vi.fn(
      async (type: string, id: string, _args?: unknown, _opts?: unknown) => ({
        entityUrl: `/${type}/${id}`,
      })
    )
    const ctx = { spawn } as any
    const tool = createForkCodingAgentTool(ctx)
    const r = await tool.execute(`tcid`, {
      source_url: `/coding-agent/source`,
      kind: `codex`,
      workspace_mode: `clone`,
      initial_prompt: `do the thing`,
    })
    expect((r as any).details.spawned).toBe(true)
    const call = spawn.mock.calls[0]!
    const [type, _id, args, opts] = call as Array<any>
    expect(type).toBe(`coding-agent`)
    expect((args as any).fromAgentId).toBe(`/coding-agent/source`)
    expect((args as any).fromWorkspaceMode).toBe(`clone`)
    expect((opts as any).initialMessage).toEqual({ text: `do the thing` })
  })
})
