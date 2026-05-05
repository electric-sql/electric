import { describe, expect, it, vi } from 'vitest'
import { assembleContext } from '../src/context-assembly'

describe(`budget enforcement`, () => {
  it(`per-source max produces an inline truncation marker for string sources`, async () => {
    const messages = await assembleContext({
      sourceBudget: 100_000,
      sources: {
        skill: {
          content: () => `x`.repeat(100_000),
          max: 400,
          cache: `stable`,
        },
      },
    })

    const output = messages.map((message) => message.content).join(`\n`)
    expect(output).toMatch(
      /\[truncated source "skill" chars=\d+\.\.\d+ snapshot=[^\]]+\]/
    )
  })

  it(`sourceBudget overflow truncates timeline oldest-first`, async () => {
    const messages = await assembleContext({
      sourceBudget: 10,
      sources: {
        self: {
          content: () => [
            { role: `user` as const, content: `x`.repeat(200), at: 1 },
            { role: `user` as const, content: `y`.repeat(200), at: 2 },
          ],
          max: 10_000,
          cache: `volatile`,
        },
      },
    })

    const output = messages.map((message) => message.content).join(`\n`)
    expect(output).toMatch(
      /\[truncated stream events offset=1\.\.\d+ — use load_timeline_range/
    )
  })

  it(`volatile sources without max are constrained by sourceBudget only`, async () => {
    const messages = await assembleContext({
      sourceBudget: 10,
      sources: {
        self: {
          content: () => [
            { role: `user` as const, content: `x`.repeat(200), at: 1 },
            { role: `user` as const, content: `y`.repeat(200), at: 2 },
          ],
          cache: `volatile`,
        },
      },
    })

    const output = messages.map((message) => message.content).join(`\n`)
    expect(output).not.toMatch(/\[truncated source "self"/)
    expect(output).toMatch(
      /\[truncated stream events offset=1\.\.\d+ — use load_timeline_range/
    )
  })

  it(`stubs oversized tool_result content instead of dropping it`, async () => {
    const messages = await assembleContext({
      sourceBudget: 100,
      sources: {
        self: {
          content: () => [
            { role: `user` as const, content: `Hi`, at: 1 },
            { role: `assistant` as const, content: `Let me check`, at: 2 },
            {
              role: `tool_call` as const,
              content: `search`,
              toolCallId: `tc-1`,
              toolName: `search`,
              toolArgs: { q: `hello` },
              at: 3,
            },
            {
              role: `tool_result` as const,
              content: `x`.repeat(5000),
              toolCallId: `tc-1`,
              isError: false,
              at: 4,
            },
            {
              role: `assistant` as const,
              content: `Here is the answer`,
              at: 5,
            },
          ],
          max: 100_000,
          cache: `volatile`,
        },
      },
    })

    const toolCalls = messages.filter((m) => m.role === `tool_call`)
    const toolResults = messages.filter((m) => m.role === `tool_result`)

    expect(toolCalls).toHaveLength(1)
    expect(toolResults).toHaveLength(1)
    expect((toolCalls[0] as any).toolCallId).toBe(`tc-1`)
    expect((toolResults[0] as any).toolCallId).toBe(`tc-1`)
    expect(toolResults[0]!.content).toMatch(/\[content truncated/)
    expect(toolResults[0]!.content).toMatch(/load_timeline_range/)
  })

  it(`drops orphaned tool_results when their tool_call is budget-truncated`, async () => {
    const messages = await assembleContext({
      sourceBudget: 30,
      sources: {
        self: {
          content: () => [
            { role: `assistant` as const, content: `I will search`, at: 1 },
            {
              role: `tool_call` as const,
              content: `search`,
              toolCallId: `tc-old`,
              toolName: `search`,
              toolArgs: {},
              at: 2,
            },
            {
              role: `tool_result` as const,
              content: `found`,
              toolCallId: `tc-old`,
              isError: false,
              at: 3,
            },
            {
              role: `assistant` as const,
              content: `Here is the answer`,
              at: 4,
            },
            { role: `user` as const, content: `Thanks`, at: 5 },
          ],
          max: 100_000,
          cache: `volatile`,
        },
      },
    })

    const toolCalls = messages.filter((m) => m.role === `tool_call`)
    const toolResults = messages.filter((m) => m.role === `tool_result`)

    for (const tr of toolResults) {
      const trId = (tr as any).toolCallId
      expect(toolCalls.some((tc) => (tc as any).toolCallId === trId)).toBe(true)
    }
    for (const tc of toolCalls) {
      const tcId = (tc as any).toolCallId
      expect(toolResults.some((tr) => (tr as any).toolCallId === tcId)).toBe(
        true
      )
    }
  })

  it(`does not write a stream event on overflow`, async () => {
    const logger = vi.fn()
    await assembleContext(
      {
        sourceBudget: 10,
        sources: {
          self: {
            content: () => [
              { role: `user` as const, content: `x`.repeat(200), at: 1 },
            ],
            max: 10_000,
            cache: `volatile`,
          },
        },
      },
      { logger }
    )

    expect(logger).toHaveBeenCalled()
  })
})
