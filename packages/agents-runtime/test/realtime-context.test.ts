import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRealtimeProvider } from '../src/realtime'
import {
  buildStreamFixture,
  createTestHandlerContext,
} from './helpers/context-test-helpers'
import type { ChangeEvent } from '@durable-streams/state'

const durableMock = vi.hoisted(() => {
  const appends: Array<{ url: string; data: unknown }> = []
  class DurableStream {
    constructor(readonly opts: { url: string }) {}

    async append(data: unknown): Promise<void> {
      appends.push({ url: this.opts.url, data })
    }

    async stream() {
      return {
        bodyStream: async function* () {},
        jsonStream: async function* () {},
        cancel: vi.fn(),
      }
    }
  }

  return { appends, DurableStream }
})

vi.mock(`@durable-streams/client`, () => ({
  DurableStream: durableMock.DurableStream,
}))

describe(`ctx.useRealtime()`, () => {
  beforeEach(() => {
    durableMock.appends.length = 0
  })

  it(`records provider transcript output as realtime transcript rows`, async () => {
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
    expect(ctx.db.collections.textDeltas.toArray).toEqual([])
    expect(ctx.db.collections.realtimeTranscripts.toArray).toMatchObject([
      {
        direction: `output`,
        text: `hello from voice`,
        status: `final`,
      },
    ])
  })

  it(`persists realtime input and output transcripts`, async () => {
    const { ctx } = createTestHandlerContext()
    const transcriptEvents: Array<{
      direction: `input` | `output`
      text: string
      status: `partial` | `final`
      turnId?: string
      responseId?: string
    }> = []

    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: createTestRealtimeProvider({
        events: [
          { type: `session.started`, sessionId: `provider-session` },
          {
            type: `input_transcript.delta`,
            delta: `hel`,
            turnId: `input-item-1`,
          },
          {
            type: `input_transcript.delta`,
            delta: `lo`,
            turnId: `input-item-1`,
          },
          {
            type: `input_transcript.completed`,
            text: `hello there`,
            turnId: `input-item-1`,
          },
          {
            type: `output_transcript.delta`,
            delta: `Hi`,
            responseId: `resp-1`,
          },
          {
            type: `output_transcript.completed`,
            text: `Hi there`,
            responseId: `resp-1`,
          },
          { type: `session.closed` },
        ],
      }),
      tools: [],
      onTranscript: (event) => {
        transcriptEvents.push(event)
      },
    })

    await realtime.run()

    expect(ctx.db.collections.realtimeTranscripts.toArray).toMatchObject([
      {
        key: `realtime-transcript:provider-session:input:input-item-1`,
        session_id: `provider-session`,
        direction: `input`,
        text: `hello there`,
        status: `final`,
        turn_id: `input-item-1`,
        audio_stream: `input`,
        created_at: expect.any(String),
      },
      {
        key: `realtime-transcript:provider-session:output:resp-1`,
        session_id: `provider-session`,
        direction: `output`,
        text: `Hi there`,
        status: `final`,
        response_id: `resp-1`,
        audio_stream: `output`,
        created_at: expect.any(String),
      },
    ])
    expect(transcriptEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: `input`,
          text: `hello there`,
          status: `final`,
          turnId: `input-item-1`,
        }),
        expect.objectContaining({
          direction: `output`,
          text: `Hi there`,
          status: `final`,
          responseId: `resp-1`,
        }),
      ])
    )
  })

  it(`anchors delayed input transcripts at speech start`, async () => {
    const db = buildStreamFixture([])
    const events: Array<ChangeEvent> = []
    const { ctx } = createTestHandlerContext({
      db,
      writeEvent: (event) => {
        events.push(event)
        db.utils.applyEvent(event)
      },
    })

    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: createTestRealtimeProvider({
        events: [
          { type: `session.started`, sessionId: `provider-session` },
          { type: `input_audio.speech_started`, turnId: `input-item-1` },
          {
            type: `output_transcript.delta`,
            delta: `Hi`,
            responseId: `resp-1`,
          },
          {
            type: `output_transcript.completed`,
            text: `Hi there`,
            responseId: `resp-1`,
          },
          {
            type: `input_transcript.completed`,
            text: `hello there`,
            turnId: `input-item-1`,
          },
          { type: `session.closed` },
        ],
      }),
      tools: [],
    })

    await realtime.run()

    const transcriptEvents = events.filter(
      (event) =>
        event.type === `realtime_transcript` &&
        event.key === `realtime-transcript:provider-session:input:input-item-1`
    )
    expect(transcriptEvents).toHaveLength(2)
    expect(transcriptEvents[0]).toMatchObject({
      headers: { operation: `insert` },
      value: {
        direction: `input`,
        text: ``,
        status: `partial`,
      },
    })
    expect(transcriptEvents[1]).toMatchObject({
      headers: { operation: `update` },
      value: {
        direction: `input`,
        text: `hello there`,
        status: `final`,
      },
    })

    const inputTranscriptInsertIndex = events.findIndex(
      (event) => event === transcriptEvents[0]
    )
    const firstAssistantTranscriptIndex = events.findIndex(
      (event) =>
        event.type === `realtime_transcript` &&
        event.key === `realtime-transcript:provider-session:output:resp-1` &&
        event.headers.operation === `insert`
    )
    expect(inputTranscriptInsertIndex).toBeGreaterThanOrEqual(0)
    expect(firstAssistantTranscriptIndex).toBeGreaterThanOrEqual(0)
    expect(inputTranscriptInsertIndex).toBeLessThan(
      firstAssistantTranscriptIndex
    )
  })

  it(`splits output transcripts around later input speech`, async () => {
    const db = buildStreamFixture([])
    const events: Array<ChangeEvent> = []
    const { ctx } = createTestHandlerContext({
      db,
      writeEvent: (event) => {
        events.push(event)
        db.utils.applyEvent(event)
      },
    })

    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: createTestRealtimeProvider({
        events: [
          { type: `session.started`, sessionId: `provider-session` },
          {
            type: `output_transcript.delta`,
            delta: `Hello `,
            responseId: `resp-1`,
          },
          { type: `input_audio.speech_started`, turnId: `input-item-1` },
          {
            type: `output_transcript.delta`,
            delta: `there`,
            responseId: `resp-1`,
          },
          {
            type: `input_transcript.completed`,
            text: `interrupting`,
            turnId: `input-item-1`,
          },
          {
            type: `output_transcript.completed`,
            text: `Hello there`,
            responseId: `resp-1`,
          },
          { type: `session.closed` },
        ],
      }),
      tools: [],
    })

    await realtime.run()

    expect(
      ctx.db.collections.realtimeTranscripts.get(
        `realtime-transcript:provider-session:output:resp-1`
      )
    ).toMatchObject({
      direction: `output`,
      text: `Hello `,
      status: `final`,
    })
    expect(
      ctx.db.collections.realtimeTranscripts.get(
        `realtime-transcript:provider-session:input:input-item-1`
      )
    ).toMatchObject({
      direction: `input`,
      text: `interrupting`,
      status: `final`,
    })
    expect(
      ctx.db.collections.realtimeTranscripts.get(
        `realtime-transcript:provider-session:output:resp-1:segment-1`
      )
    ).toMatchObject({
      direction: `output`,
      text: `there`,
      status: `final`,
    })

    const firstOutputInsertIndex = events.findIndex(
      (event) =>
        event.type === `realtime_transcript` &&
        event.key === `realtime-transcript:provider-session:output:resp-1` &&
        event.headers.operation === `insert`
    )
    const inputInsertIndex = events.findIndex(
      (event) =>
        event.type === `realtime_transcript` &&
        event.key ===
          `realtime-transcript:provider-session:input:input-item-1` &&
        event.headers.operation === `insert`
    )
    const secondOutputInsertIndex = events.findIndex(
      (event) =>
        event.type === `realtime_transcript` &&
        event.key ===
          `realtime-transcript:provider-session:output:resp-1:segment-1` &&
        event.headers.operation === `insert`
    )
    expect(firstOutputInsertIndex).toBeGreaterThanOrEqual(0)
    expect(inputInsertIndex).toBeGreaterThan(firstOutputInsertIndex)
    expect(secondOutputInsertIndex).toBeGreaterThan(inputInsertIndex)
  })

  it(`finds active realtime sessions from the manifest`, () => {
    const { ctx } = createTestHandlerContext()

    ctx.db.collections.manifests.insert({
      key: `realtime-session:rt-1`,
      kind: `realtime-session`,
      id: `rt-1`,
      provider: `openai`,
      model: `gpt-realtime`,
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

  it(`marks realtime sessions closed when the provider stream ends`, async () => {
    const { ctx } = createTestHandlerContext()

    ctx.db.collections.manifests.insert({
      key: `realtime-session:rt-1`,
      kind: `realtime-session`,
      id: `rt-1`,
      provider: `openai`,
      model: `gpt-realtime`,
      status: `requested`,
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

    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: createTestRealtimeProvider({ response: `done` }),
      tools: [],
    })

    await realtime.run()

    expect(ctx.realtime.activeSession()).toBeUndefined()
    expect(
      ctx.db.collections.manifests.get(`realtime-session:rt-1`)
    ).toMatchObject({
      status: `closed`,
      endedAt: expect.any(String),
      meta: { reason: `completed` },
    })
    expect(
      ctx.db.collections.realtimeSessions.get(`realtime-session:rt-1`)
    ).toMatchObject({
      status: `closed`,
      ended_at: expect.any(String),
      reason: `completed`,
    })
  })

  it(`marks realtime sessions failed when provider setup fails`, async () => {
    const { ctx } = createTestHandlerContext()

    ctx.db.collections.manifests.insert({
      key: `realtime-session:rt-1`,
      kind: `realtime-session`,
      id: `rt-1`,
      provider: `openai`,
      model: `gpt-realtime`,
      status: `requested`,
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

    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: {
        id: `openai`,
        model: `gpt-realtime`,
        connect: async () => {
          throw new Error(`missing key`)
        },
      },
      tools: [],
    })

    await expect(realtime.run()).rejects.toThrow(`missing key`)
    expect(ctx.realtime.activeSession()).toBeUndefined()
    expect(
      ctx.db.collections.manifests.get(`realtime-session:rt-1`)
    ).toMatchObject({
      status: `failed`,
      endedAt: expect.any(String),
      meta: { error: `missing key` },
    })
  })

  it(`does not fail the run when OpenAI reports inactive response cancellation`, async () => {
    const { ctx } = createTestHandlerContext()

    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: createTestRealtimeProvider({
        events: [
          { type: `session.started` },
          {
            type: `session.error`,
            code: `response_cancel_not_active`,
            error: `Cancellation failed: no active response found`,
          },
          { type: `session.closed` },
        ],
      }),
      tools: [],
    })

    await expect(realtime.run()).resolves.toMatchObject({
      usage: { tokens: 0 },
    })
    expect(ctx.db.collections.runs.toArray).toMatchObject([
      { status: `completed`, finish_reason: `stop` },
    ])
  })

  it(`does not fail the run when OpenAI reports a stale output audio truncate`, async () => {
    const { ctx } = createTestHandlerContext()

    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: createTestRealtimeProvider({
        events: [
          { type: `session.started` },
          {
            type: `session.error`,
            code: `invalid_value`,
            error: `Audio content of 6350ms is already shorter than 8160ms`,
          },
          { type: `session.closed` },
        ],
      }),
      tools: [],
    })

    await expect(realtime.run()).resolves.toMatchObject({
      usage: { tokens: 0 },
    })
    expect(ctx.db.collections.runs.toArray).toMatchObject([
      { status: `completed`, finish_reason: `stop` },
    ])
  })

  it(`persists provider audio and control output to realtime durable streams`, async () => {
    const { ctx } = createTestHandlerContext({
      realtimeStreams: {
        baseUrl: `http://server.test`,
        headers: { authorization: `Bearer claim` },
      },
    })
    ctx.db.collections.manifests.insert({
      key: `realtime-session:rt-1`,
      kind: `realtime-session`,
      id: `rt-1`,
      provider: `openai`,
      model: `gpt-realtime`,
      status: `active`,
      startedAt: `2026-06-09T12:00:00.000Z`,
      endedAt: null,
      retention: `forever`,
      streams: {
        audio_in: `/test/entity/realtime/rt-1/audio/in`,
        audio_out: `/test/entity/realtime/rt-1/audio/out`,
        control_in: `/test/entity/realtime/rt-1/control/in`,
        control_out: `/test/entity/realtime/rt-1/control/out`,
      },
    })

    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: createTestRealtimeProvider({
        events: [
          { type: `session.started`, sessionId: `rt-1` },
          {
            type: `output_audio.delta`,
            audio: new Uint8Array([1, 2, 3]),
            responseId: `resp-1`,
            itemId: `item-1`,
          },
          { type: `output_audio.completed`, responseId: `resp-1` },
          { type: `session.closed` },
        ],
      }),
      tools: [],
    })

    await realtime.run()

    expect(durableMock.appends).toEqual([
      {
        url: `http://server.test/test/entity/realtime/rt-1/control/out`,
        data: expect.any(Uint8Array),
      },
      {
        url: `http://server.test/test/entity/realtime/rt-1/audio/out`,
        data: new Uint8Array([1, 2, 3]),
      },
      {
        url: `http://server.test/test/entity/realtime/rt-1/control/out`,
        data: expect.any(Uint8Array),
      },
      {
        url: `http://server.test/test/entity/realtime/rt-1/control/out`,
        data: expect.any(Uint8Array),
      },
      {
        url: `http://server.test/test/entity/realtime/rt-1/control/out`,
        data: expect.any(Uint8Array),
      },
    ])
    const decoder = new TextDecoder()
    expect(
      JSON.parse(decoder.decode(durableMock.appends[2]!.data as Uint8Array))
    ).toEqual({
      type: `output_audio.delta`,
      responseId: `resp-1`,
      itemId: `item-1`,
      byteLength: 3,
    })
  })
})
