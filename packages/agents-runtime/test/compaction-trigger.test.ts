import { describe, expect, it } from 'vitest'
import { createAssistantMessageEventStream } from '@mariozechner/pi-ai'
import {
  buildStreamFixture,
  createTestHandlerContext,
} from './helpers/context-test-helpers'
import type { ChangeEvent } from '@durable-streams/state'

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

describe(`synchronous compaction trigger`, () => {
  it(`compacts at the 95% hard ceiling: model sees the summary, checkpoint persisted`, async () => {
    // A large prior message (≈1000 tokens) and a step reporting 98% usage of a
    // small (test) 1000-token window — over the 95% ceiling and worth
    // compacting (approxTokens > window/2).
    const db = buildStreamFixture([
      { kind: `inbox`, at: 1, value: { payload: `A`.repeat(4000) } },
    ])
    ;(
      db.collections as unknown as { steps: { insert: (r: unknown) => void } }
    ).steps.insert({
      key: `step-1`,
      _seq: 1,
      run_id: `r`,
      step_number: 1,
      status: `completed`,
      context_input_tokens: 980,
      context_window: 1000,
    })

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

    // Summarizer ran…
    expect(summarizeCalled).toBe(true)
    // …the model saw the summary, not the giant original message…
    expect(captured).toContain(`COMPACTED_SUMMARY`)
    expect(captured).not.toContain(`AAAAAAAAAAAAAAAAAAAA`)
    // …and the checkpoint went through the running → complete lifecycle
    // (so the UI can show a live "compacting" entry then the final marker).
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

  it(`does not compact below the hard ceiling`, async () => {
    const db = buildStreamFixture([
      { kind: `inbox`, at: 1, value: { payload: `A`.repeat(4000) } },
    ])
    ;(
      db.collections as unknown as { steps: { insert: (r: unknown) => void } }
    ).steps.insert({
      key: `step-1`,
      _seq: 1,
      run_id: `r`,
      step_number: 1,
      status: `completed`,
      context_input_tokens: 500, // 50% — below the 95% ceiling
      context_window: 1000,
    })

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
