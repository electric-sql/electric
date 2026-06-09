import { describe, expect, it } from 'vitest'
import { createTestRealtimeProvider } from '../src/realtime'
import { createTestHandlerContext } from './helpers/context-test-helpers'

describe(`ctx.useRealtime()`, () => {
  it(`records provider transcript output through the outbound bridge`, async () => {
    const { ctx } = createTestHandlerContext()

    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: createTestRealtimeProvider({ response: `hello from voice` }),
      tools: [],
    })

    await realtime.run()

    expect(ctx.db.collections.runs.toArray).toMatchObject([
      { key: `run-0`, status: `completed`, finish_reason: `stop` },
    ])
    expect(ctx.db.collections.steps.toArray).toMatchObject([
      {
        key: `step-0`,
        run_id: `run-0`,
        model_provider: `test`,
        model_id: `test-realtime`,
        status: `completed`,
        finish_reason: `stop`,
      },
    ])
    expect(ctx.db.collections.textDeltas.toArray).toMatchObject([
      {
        text_id: `msg-0`,
        run_id: `run-0`,
        delta: `hello from voice`,
      },
    ])
  })

  it(`finds active realtime sessions from the manifest`, () => {
    const { ctx } = createTestHandlerContext()

    ctx.db.collections.manifests.insert({
      key: `realtime-session:rt-1`,
      kind: `realtime-session`,
      id: `rt-1`,
      provider: `openai`,
      model: `gpt-realtime-2`,
      status: `active`,
      startedAt: `2026-06-09T12:00:00.000Z`,
      endedAt: null,
      retention: `forever`,
      streams: {
        audio_in: `/entities/test/realtime/rt-1/audio/in`,
        audio_out: `/entities/test/realtime/rt-1/audio/out`,
        control_in: `/entities/test/realtime/rt-1/control/in`,
        control_out: `/entities/test/realtime/rt-1/control/out`,
      },
    })

    expect(ctx.realtime.activeSession()).toMatchObject({
      id: `rt-1`,
      status: `active`,
    })
  })
})
