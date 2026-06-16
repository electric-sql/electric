import { describe, expect, it } from 'vitest'
import { summarizeMessages } from '../src/compaction-summarize'
import type { SummarizeCompleteFn } from '../src/compaction-summarize'
import type { LLMMessage } from '../src/types'

const messages: Array<LLMMessage> = [
  { role: `user`, content: `please build a thing` },
  { role: `assistant`, content: `working on it` },
]

describe(`summarizeMessages`, () => {
  it(`sends history + the summarization prompt and prefixes the result`, async () => {
    let sawPrompt = false
    let sawHistory = false
    const complete: SummarizeCompleteFn = async (_model, context) => {
      // History content is normalized into text blocks, so search the
      // serialized messages rather than assuming a string content.
      const serialized = JSON.stringify(context.messages)
      sawHistory = serialized.includes(`please build a thing`)
      sawPrompt = serialized.includes(`CONTEXT CHECKPOINT COMPACTION`)
      // the prompt must be the LAST message
      expect(JSON.stringify(context.messages.at(-1))).toContain(
        `CONTEXT CHECKPOINT COMPACTION`
      )
      return { content: [{ type: `text`, text: `SUMMARY_BODY` }] }
    }

    const out = await summarizeMessages({
      model: `claude-sonnet-4-5-20250929`,
      messages,
      complete,
    })

    expect(sawHistory).toBe(true)
    expect(sawPrompt).toBe(true)
    // Codex summary preamble is prepended…
    expect(out).toContain(
      `Another language model started to solve this problem`
    )
    // …followed by the model's summary body.
    expect(out).toContain(`SUMMARY_BODY`)
  })

  it(`rejects (does not hang) when the model call stalls past the timeout`, async () => {
    // A stalled stream that never resolves — the real failure mode that wedged
    // background compaction. The timeout must turn it into a rejection.
    let aborted = false
    const complete: SummarizeCompleteFn = (_model, _context, options) =>
      // Never settles on its own — models a stalled stream that ignores abort,
      // so only the hard timer can break the wait.
      new Promise(() => {
        const signal = (options as { signal?: AbortSignal } | undefined)?.signal
        signal?.addEventListener(`abort`, () => {
          aborted = true
        })
      })

    await expect(
      summarizeMessages({
        model: `claude-sonnet-4-5-20250929`,
        messages,
        complete,
        timeoutMs: 20,
      })
    ).rejects.toThrow(/timed out after 20ms/)
    // The caller is also signalled to abort so the underlying fetch can unwind.
    expect(aborted).toBe(true)
  })

  it(`throws when the model returns an empty summary`, async () => {
    const complete: SummarizeCompleteFn = async () => ({
      content: [{ type: `text`, text: `   ` }],
      stopReason: `stop`,
    })
    await expect(
      summarizeMessages({
        model: `claude-sonnet-4-5-20250929`,
        messages,
        complete,
      })
    ).rejects.toThrow(/empty summary/)
  })
})
