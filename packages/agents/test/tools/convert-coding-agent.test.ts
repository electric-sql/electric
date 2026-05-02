import { describe, expect, it, vi } from 'vitest'
import { createConvertCodingAgentTool } from '../../src/tools/convert-coding-agent'

describe(`convert_coding_agent tool`, () => {
  it(`sends a convert-kind message with the right payload`, async () => {
    const send = vi.fn()
    const ctx = { send } as any
    const tool = createConvertCodingAgentTool(ctx)
    const r = await tool.execute(`tcid`, {
      coding_agent_url: `/coding-agent/foo`,
      kind: `codex`,
      model: `gpt-5-codex-latest`,
    })
    expect((r as any).details.converted).toBe(true)
    expect(send).toHaveBeenCalledWith(
      `/coding-agent/foo`,
      { kind: `codex`, model: `gpt-5-codex-latest` },
      { type: `convert-kind` }
    )
  })

  it(`rejects malformed url`, async () => {
    const ctx = { send: vi.fn() } as any
    const tool = createConvertCodingAgentTool(ctx)
    const r = await tool.execute(`x`, {
      coding_agent_url: `foo`,
      kind: `codex`,
    })
    expect((r as any).details.converted).toBe(false)
  })
})
