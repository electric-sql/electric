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
    })
    const out = await compact({
      messages: msgs(10),
      currentTokens: 1000, // 10% of window
      contextWindow: 10000,
    })
    expect(out).toBeNull()
    expect(summarize).not.toHaveBeenCalled()
  })

  it(`compacts over the ceiling: summarizes the WHOLE context, continues from [summary]`, async () => {
    const summarize = vi.fn().mockResolvedValue(`SUMMARY`)
    const statuses: Array<string> = []
    const writeCheckpoint = vi.fn((s: string) => statuses.push(s))
    const compact = createMidTurnCompactor({
      summarize,
      writeCheckpoint,
      ceiling: 0.9,
    })
    const messages = msgs(10)
    const out = await compact({
      messages,
      currentTokens: 9500, // 95%
      contextWindow: 10000,
    })
    // The entire context is folded (no verbatim tail kept), so the summary and
    // the checkpoint's timeline-head watermark agree.
    expect(summarize).toHaveBeenCalledTimes(1)
    expect((summarize.mock.calls[0]![0] as Array<unknown>).length).toBe(10)
    expect(statuses).toEqual([`running`, `complete`])
    expect(out).not.toBeNull()
    expect(out!.length).toBe(1) // summary only
    expect(JSON.stringify(out![0])).toContain(`SUMMARY`)
  })

  it(`is sticky: reuses the cached summary and appends messages added since`, async () => {
    const summarize = vi.fn().mockResolvedValue(`SUMMARY`)
    const compact = createMidTurnCompactor({
      summarize,
      writeCheckpoint: vi.fn(),
      ceiling: 0.9,
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
    expect(out!.length).toBe(1 + 1) // summary + the one message added since
    expect(out![1]).toBe(grown[10])
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
    // The re-summarization input is [prior summary, ...the messages added since]
    // (chained, not the whole already-summarized bulk re-read).
    const secondInput = summarize.mock.calls[1]![0] as Array<unknown>
    expect(secondInput.length).toBe(1 + 10) // SUMMARY1 + msgs 10..19
    expect(JSON.stringify(secondInput[0])).toContain(`SUMMARY1`)
    expect(JSON.stringify(out![0])).toContain(`SUMMARY2`)
  })

  it(`on failure writes "failed" and leaves context untouched`, async () => {
    const summarize = vi.fn().mockRejectedValue(new Error(`boom`))
    const statuses: Array<string> = []
    const compact = createMidTurnCompactor({
      summarize,
      writeCheckpoint: (s: string) => statuses.push(s),
      ceiling: 0.9,
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
