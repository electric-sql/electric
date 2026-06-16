import { describe, expect, it, vi } from 'vitest'
import { createMidTurnCompactor } from '../src/compaction-midturn'
import type { AgentMessageLike } from '../src/compaction-midturn'

function msgs(n: number): Array<AgentMessageLike> {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 ? `assistant` : `user`,
    content: `m${i}`,
  }))
}

describe(`createMidTurnCompactor`, () => {
  it(`leaves context untouched below the ceiling`, async () => {
    const summarize = vi.fn()
    const writeCheckpoint = vi.fn()
    const compact = createMidTurnCompactor({
      summarize,
      writeCheckpoint,
      ceiling: 0.9,
      minTokens: 100,
      keepTail: 4,
    })
    const out = await compact({
      messages: msgs(10),
      currentTokens: 1000, // 10% of window
      contextWindow: 10000,
    })
    expect(out).toBeNull()
    expect(summarize).not.toHaveBeenCalled()
  })

  it(`compacts over the ceiling: running→complete + [summary, ...tail]`, async () => {
    const summarize = vi.fn().mockResolvedValue(`SUMMARY`)
    const statuses: Array<string> = []
    const writeCheckpoint = vi.fn((s: string) => statuses.push(s))
    const compact = createMidTurnCompactor({
      summarize,
      writeCheckpoint,
      ceiling: 0.9,
      minTokens: 100,
      keepTail: 4,
    })
    const messages = msgs(10)
    const out = await compact({
      messages,
      currentTokens: 9500, // 95%
      contextWindow: 10000,
    })
    // folded the first 6 (10 − keepTail 4)
    expect(summarize).toHaveBeenCalledTimes(1)
    expect((summarize.mock.calls[0]![0] as Array<unknown>).length).toBe(6)
    expect(statuses).toEqual([`running`, `complete`])
    expect(out).not.toBeNull()
    expect(out!.length).toBe(1 + 4) // summary + recent tail
    expect(JSON.stringify(out![0])).toContain(`SUMMARY`)
    expect(out![1]).toBe(messages[6]) // tail begins at coveredCount=6
  })

  it(`is sticky: reuses the cached summary below the ceiling`, async () => {
    const summarize = vi.fn().mockResolvedValue(`SUMMARY`)
    const compact = createMidTurnCompactor({
      summarize,
      writeCheckpoint: vi.fn(),
      ceiling: 0.9,
      minTokens: 100,
      keepTail: 4,
    })
    const messages = msgs(10)
    await compact({ messages, currentTokens: 9500, contextWindow: 10000 })
    summarize.mockClear()
    const grown = [...messages, { role: `user`, content: `new` }]
    const out = await compact({
      messages: grown,
      currentTokens: 2000, // 20%, well under ceiling
      contextWindow: 10000,
    })
    expect(summarize).not.toHaveBeenCalled() // reused, not re-summarized
    expect(JSON.stringify(out![0])).toContain(`SUMMARY`)
    expect(out!.length).toBe(1 + 5) // summary + (4 original tail + 1 new)
  })

  it(`re-summarizes by chaining off the previous summary`, async () => {
    const summarize = vi
      .fn()
      .mockResolvedValueOnce(`SUMMARY1`)
      .mockResolvedValueOnce(`SUMMARY2`)
    const compact = createMidTurnCompactor({
      summarize,
      writeCheckpoint: vi.fn(),
      ceiling: 0.9,
      minTokens: 100,
      keepTail: 4,
    })
    await compact({
      messages: msgs(10),
      currentTokens: 9500,
      contextWindow: 10000,
    })
    const out = await compact({
      messages: msgs(20),
      currentTokens: 9500,
      contextWindow: 10000,
    })
    expect(summarize).toHaveBeenCalledTimes(2)
    // the re-summarization input starts with the prior summary (chained)
    const secondInput = summarize.mock.calls[1]![0] as Array<unknown>
    expect(JSON.stringify(secondInput[0])).toContain(`SUMMARY1`)
    expect(JSON.stringify(out![0])).toContain(`SUMMARY2`)
  })

  it(`never starts the kept tail with an orphaned tool_result`, async () => {
    const summarize = vi.fn().mockResolvedValue(`SUMMARY`)
    const compact = createMidTurnCompactor({
      summarize,
      writeCheckpoint: vi.fn(),
      ceiling: 0.9,
      minTokens: 100,
      keepTail: 4,
    })
    // Boundary would land at index 6 (10 − keepTail 4); make that a tool_result
    // whose tool_use (index 5 assistant) is being folded. The fold boundary must
    // advance past it so the tail starts on the assistant turn at index 7.
    const messages = msgs(10)
    messages[6] = { role: `toolResult`, content: `tr` }
    const out = await compact({
      messages,
      currentTokens: 9500,
      contextWindow: 10000,
    })
    expect((summarize.mock.calls[0]![0] as Array<unknown>).length).toBe(7)
    expect(out![1]).toBe(messages[7])
    expect((out![1] as { role: string }).role).toBe(`assistant`)
  })

  it(`on failure writes "failed" and leaves context untouched`, async () => {
    const summarize = vi.fn().mockRejectedValue(new Error(`boom`))
    const statuses: Array<string> = []
    const compact = createMidTurnCompactor({
      summarize,
      writeCheckpoint: (s: string) => statuses.push(s),
      ceiling: 0.9,
      minTokens: 100,
      keepTail: 4,
    })
    const out = await compact({
      messages: msgs(10),
      currentTokens: 9500,
      contextWindow: 10000,
    })
    expect(statuses).toEqual([`running`, `failed`])
    expect(out).toBeNull() // no prior compaction → untouched
  })
})
