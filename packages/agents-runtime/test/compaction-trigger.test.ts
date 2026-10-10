import { afterEach, describe, expect, it } from 'vitest'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai/compat'
import {
  buildStreamFixture,
  createTestHandlerContext,
} from './helpers/context-test-helpers'
import type { ChangeEvent } from '@durable-streams/state'

// The mid-turn compactor gates on (real last-step usage + trailing estimate) vs
// the MODEL's context window. We can't shrink the real window in a unit test, so
// we drive the trigger with the env override + a high seeded anchor instead.
const savedEnv = {
  ceiling: process.env.ELECTRIC_AGENTS_COMPACT_CEILING,
}
afterEach(() => {
  process.env.ELECTRIC_AGENTS_COMPACT_CEILING = savedEnv.ceiling
})

function completedAssistantMessage(): unknown {
  return {
    role: `assistant`,
    content: [{ type: `text`, text: `ok` }],
    api: `anthropic-messages`,
    provider: `anthropic`,
    model: `claude-sonnet-4-5-20250929`,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: `stop`,
    timestamp: Date.now(),
  }
}

function seedStep(
  db: ReturnType<typeof buildStreamFixture>,
  contextInputTokens: number
): void {
  ;(
    db.collections as unknown as { steps: { insert: (r: unknown) => void } }
  ).steps.insert({
    key: `step-1`,
    _seq: 1,
    run_id: `r`,
    step_number: 1,
    status: `completed`,
    context_input_tokens: contextInputTokens,
    context_window: 200000,
  })
}

describe(`mid-turn compaction trigger`, () => {
  it(`compacts mid-turn: summarizer runs, model sees the summary, checkpoint persisted`, async () => {
    // Ceiling tiny so any real model window is crossed by the seeded anchor.
    process.env.ELECTRIC_AGENTS_COMPACT_CEILING = `0.0001`

    // Enough messages that there's real content beyond the kept tail (6).
    const db = buildStreamFixture(
      Array.from({ length: 8 }, (_, i) => ({
        kind: `inbox` as const,
        at: i + 1,
        value: { payload: `MESSAGE_${i}` },
      }))
    )
    seedStep(db, 50_000) // high anchor → over the tiny ceiling

    const writes: Array<ChangeEvent> = []
    const { ctx } = createTestHandlerContext({
      db,
      writeEvent: (event: ChangeEvent) => {
        writes.push(event)
        db.utils.applyEvent(event)
      },
    })

    let captured = ``
    let summarizeCalled = false
    ctx.useAgent({
      systemPrompt: `test`,
      model: `claude-sonnet-4-5-20250929`,
      tools: [],
      summarizeComplete: async () => {
        summarizeCalled = true
        return { content: [{ type: `text`, text: `COMPACTED_SUMMARY` }] }
      },
      streamFn: ((_model: unknown, context: unknown) => {
        captured = JSON.stringify(context)
        const stream = createAssistantMessageEventStream()
        queueMicrotask(() => stream.end(completedAssistantMessage() as never))
        return stream
      }) as never,
    })

    await ctx.agent.run(`continue`)

    expect(summarizeCalled).toBe(true)
    expect(captured).toContain(`COMPACTED_SUMMARY`)
    const statuses = writes
      .map(
        (event) =>
          (
            event.value as
              | { attrs?: { kind?: string; status?: string } }
              | undefined
          )?.attrs
      )
      .filter((attrs) => attrs?.kind === `compaction`)
      .map((attrs) => attrs?.status)
    expect(statuses).toContain(`running`)
    expect(statuses).toContain(`complete`)
  })

  it(`does not compact when well under the ceiling`, async () => {
    // Default ceiling (0.9); a small anchor against the real ~200k+ window.
    const db = buildStreamFixture([
      { kind: `inbox`, at: 1, value: { payload: `hello` } },
    ])
    seedStep(db, 500)

    let summarizeCalled = false
    const { ctx } = createTestHandlerContext({ db })
    ctx.useAgent({
      systemPrompt: `test`,
      model: `claude-sonnet-4-5-20250929`,
      tools: [],
      summarizeComplete: async () => {
        summarizeCalled = true
        return { content: [{ type: `text`, text: `X` }] }
      },
      streamFn: ((_model: unknown) => {
        const stream = createAssistantMessageEventStream()
        queueMicrotask(() => stream.end(completedAssistantMessage() as never))
        return stream
      }) as never,
    })

    await ctx.agent.run(`continue`)
    expect(summarizeCalled).toBe(false)
  })
})
