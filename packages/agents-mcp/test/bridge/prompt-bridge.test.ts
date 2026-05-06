import { describe, expect, it } from 'vitest'
import { bridgePromptTools } from '../../src/bridge/prompt-bridge'

describe(`bridgePromptTools`, () => {
  it(`exposes list + get`, async () => {
    const tools = bridgePromptTools({
      server: `gh`,
      invoke: async (s, method, args) =>
        method === `prompts/list`
          ? { prompts: [{ name: `greet` }] }
          : {
              messages: [
                {
                  role: `user`,
                  content: {
                    type: `text`,
                    text: `hi ${(args as { name: string }).name}`,
                  },
                },
              ],
            },
      timeoutMs: 30_000,
    })
    expect(tools.map((t) => t.name)).toEqual([
      `mcp__gh__list_prompts`,
      `mcp__gh__get_prompt`,
    ])
    const list = await tools[0].run({})
    expect((list as { prompts: unknown[] }).prompts).toHaveLength(1)
    const get = await tools[1].run({
      name: `greet`,
      arguments: { name: `world` },
    })
    expect(
      (get as { messages: Array<{ content: { text: string } }> }).messages[0]
        .content.text
    ).toBe(`hi greet`)
  })
})
