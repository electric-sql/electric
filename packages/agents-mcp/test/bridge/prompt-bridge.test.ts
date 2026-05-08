import { describe, expect, it, vi } from 'vitest'
import { buildPromptTools } from '../../src/bridge/prompt-bridge'

describe(`prompt bridge`, () => {
  it(`emits list_prompts and get_prompt tools with prefixed names`, () => {
    const client = {
      listPrompts: async () => ({ prompts: [] }),
      getPrompt: async () => ({ messages: [] }),
    } as any
    const tools = buildPromptTools({ server: `mock`, client })
    expect(tools.map((t) => t.name)).toEqual([
      `mcp__mock__list_prompts`,
      `mcp__mock__get_prompt`,
    ])
  })

  it(`get_prompt forwards name and arguments`, async () => {
    const getPrompt = vi.fn(async () => ({ messages: [] }))
    const client = {
      listPrompts: async () => ({ prompts: [] }),
      getPrompt,
    } as any
    const [, get] = buildPromptTools({ server: `mock`, client })
    await get!.call({ name: `p`, arguments: { a: 1 } })
    expect(getPrompt).toHaveBeenCalledWith({ name: `p`, arguments: { a: 1 } })
  })
})
