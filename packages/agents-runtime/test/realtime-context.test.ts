import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestRealtimeProvider } from '../src/realtime'
import {
  buildStreamFixture,
  createTestHandlerContext,
} from './helpers/context-test-helpers'
import type { ChangeEvent } from '@durable-streams/state'
import type { WakeEvent } from '../src/types'

const durableMock = vi.hoisted(() => {
  type StreamSource<T> = Iterable<T> | AsyncIterable<T>
  const appends: Array<{ url: string; data: unknown }> = []
  const bodyStreams = new Map<string, StreamSource<Uint8Array>>()
  const jsonStreams = new Map<string, StreamSource<unknown>>()
  class DurableStream {
    constructor(readonly opts: { url: string }) {}

    async append(data: unknown): Promise<void> {
      appends.push({ url: this.opts.url, data })
    }

    async stream() {
      const url = this.opts.url
      return {
        bodyStream: async function* () {
          for await (const chunk of bodyStreams.get(url) ?? []) {
            yield chunk
          }
        },
        jsonStream: async function* () {
          for await (const event of jsonStreams.get(url) ?? []) {
            yield event
          }
        },
        cancel: vi.fn(),
      }
    }
  }

  return { appends, bodyStreams, jsonStreams, DurableStream }
})

vi.mock(`@durable-streams/client`, () => ({
  DurableStream: durableMock.DurableStream,
}))

describe(`ctx.useRealtime()`, () => {
  beforeEach(() => {
    durableMock.appends.length = 0
    durableMock.bodyStreams.clear()
    durableMock.jsonStreams.clear()
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
    expect(ctx.db.collections.textDeltas.toArray).toMatchObject([
      {
        key: `realtime-transcript:ephemeral:output:fallback-0:delta-0`,
        text_id: `realtime-transcript:ephemeral:output:fallback-0`,
        realtime_transcript_id: `realtime-transcript:ephemeral:output:fallback-0`,
        delta: `hello from voice`,
      },
    ])
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
    expect(ctx.db.collections.textDeltas.toArray).toMatchObject([
      {
        key: `realtime-transcript:provider-session:input:input-item-1:delta-0`,
        text_id: `realtime-transcript:provider-session:input:input-item-1`,
        realtime_transcript_id: `realtime-transcript:provider-session:input:input-item-1`,
        delta: `hel`,
      },
      {
        key: `realtime-transcript:provider-session:input:input-item-1:delta-1`,
        text_id: `realtime-transcript:provider-session:input:input-item-1`,
        realtime_transcript_id: `realtime-transcript:provider-session:input:input-item-1`,
        delta: `lo`,
      },
      {
        key: `realtime-transcript:provider-session:input:input-item-1:delta-2`,
        text_id: `realtime-transcript:provider-session:input:input-item-1`,
        realtime_transcript_id: `realtime-transcript:provider-session:input:input-item-1`,
        delta: ` there`,
      },
      {
        key: `realtime-transcript:provider-session:output:resp-1:delta-0`,
        text_id: `realtime-transcript:provider-session:output:resp-1`,
        realtime_transcript_id: `realtime-transcript:provider-session:output:resp-1`,
        delta: `Hi`,
      },
      {
        key: `realtime-transcript:provider-session:output:resp-1:delta-1`,
        text_id: `realtime-transcript:provider-session:output:resp-1`,
        realtime_transcript_id: `realtime-transcript:provider-session:output:resp-1`,
        delta: ` there`,
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

  it(`uses one output transcript source family per response`, async () => {
    const { ctx } = createTestHandlerContext()

    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: createTestRealtimeProvider({
        events: [
          { type: `session.started`, sessionId: `provider-session` },
          {
            type: `output_transcript.delta`,
            delta: `Text duplicate`,
            responseId: `resp-1`,
            itemId: `item-1`,
            transcriptSource: `response.output_text`,
          },
          {
            type: `output_transcript.delta`,
            delta: `Audio transcript`,
            responseId: `resp-1`,
            itemId: `item-1`,
            transcriptSource: `response.output_audio_transcript`,
          },
          {
            type: `output_transcript.delta`,
            delta: ` ignored`,
            responseId: `resp-1`,
            itemId: `item-1`,
            transcriptSource: `response.output_text`,
          },
          {
            type: `output_transcript.completed`,
            text: `Audio transcript final`,
            responseId: `resp-1`,
            itemId: `item-1`,
            transcriptSource: `response.output_audio_transcript`,
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
      text: `Audio transcript final`,
      status: `final`,
    })
  })

  it(`does not seed active realtime session transcripts into provider history`, async () => {
    const { ctx } = createTestHandlerContext()
    const capturedMessages: Array<unknown> = []

    ctx.db.collections.manifests.insert({
      key: `realtime-session:rt-1`,
      kind: `realtime-session`,
      id: `rt-1`,
      provider: `test`,
      model: `test-realtime`,
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
    ctx.db.collections.realtimeTranscripts.insert({
      key: `rt-active`,
      session_id: `rt-1`,
      direction: `input`,
      text: `active session text`,
      status: `final`,
      audio_stream: `input`,
      created_at: `2026-06-09T12:00:01.000Z`,
    })
    ctx.db.collections.realtimeTranscripts.insert({
      key: `rt-prior`,
      session_id: `rt-prior`,
      direction: `input`,
      text: `prior session text`,
      status: `final`,
      audio_stream: `input`,
      created_at: `2026-06-09T11:00:01.000Z`,
    })

    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: {
        id: `test`,
        model: `test-realtime`,
        async connect(input) {
          capturedMessages.push(...input.messages)
          return {
            events: (async function* () {
              yield { type: `session.started` as const, sessionId: `rt-1` }
              yield { type: `session.closed` as const }
            })(),
          }
        },
      },
      tools: [],
    })

    await realtime.run()

    expect(capturedMessages).toEqual([
      { role: `user`, content: `prior session text` },
    ])
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

  it(`marks realtime sessions closed when the provider stream ends`, async () => {
    const { ctx } = createTestHandlerContext()

    ctx.db.collections.manifests.insert({
      key: `realtime-session:rt-1`,
      kind: `realtime-session`,
      id: `rt-1`,
      provider: `openai`,
      model: `gpt-realtime-2`,
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
      model: `gpt-realtime-2`,
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
        model: `gpt-realtime-2`,
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

  it(`does not create legacy tool rows for out-of-order realtime tool completions`, async () => {
    const { ctx } = createTestHandlerContext()

    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: createTestRealtimeProvider({
        events: [
          { type: `session.started` },
          {
            type: `tool_call.arguments_completed`,
            toolCallId: `call-1`,
            name: `first_tool`,
            args: { value: 1 },
          },
          {
            type: `tool_call.arguments_completed`,
            toolCallId: `call-2`,
            name: `second_tool`,
            args: { value: 2 },
          },
          {
            type: `tool_call.completed`,
            toolCallId: `call-1`,
            name: `first_tool`,
            result: `first done`,
          },
          {
            type: `tool_call.completed`,
            toolCallId: `call-2`,
            name: `second_tool`,
            result: `second done`,
          },
          { type: `session.closed` },
        ],
      }),
      tools: [],
    })

    await realtime.run()

    expect(ctx.db.collections.toolCalls.toArray).toMatchObject([
      {
        tool_call_id: `call-1`,
        tool_name: `first_tool`,
        status: `completed`,
      },
      {
        tool_call_id: `call-2`,
        tool_name: `second_tool`,
        status: `completed`,
      },
    ])
    expect(
      ctx.db.collections.toolCalls.toArray.some((toolCall) =>
        toolCall.tool_call_id?.startsWith(`legacy-tc-`)
      )
    ).toBe(false)
  })

  it(`forwards live inbox notifications to the active realtime provider`, async () => {
    let liveWakeHandler:
      | ((wake: {
          wakeEvent: WakeEvent
          wakeOffset: string
          ackOffset: string
          events: Array<ChangeEvent>
        }) => boolean | Promise<boolean>)
      | undefined
    let resolveRegistered!: () => void
    const registered = new Promise<void>((resolve) => {
      resolveRegistered = resolve
    })
    let closeProvider!: () => void
    const providerClosed = new Promise<void>((resolve) => {
      closeProvider = resolve
    })
    const sendText = vi.fn(async () => undefined)
    const prepareAgentRun = vi.fn(async () => undefined)
    const { ctx } = createTestHandlerContext({
      prepareAgentRun,
      registerLiveWakeHandler: (handler) => {
        liveWakeHandler = handler
        resolveRegistered()
        return () => {
          if (liveWakeHandler === handler) {
            liveWakeHandler = undefined
          }
        }
      },
    })

    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: {
        id: `test`,
        model: `test-realtime`,
        async connect() {
          return {
            events: (async function* () {
              yield { type: `session.started` as const }
              await providerClosed
              yield { type: `session.closed` as const }
            })(),
            sendText,
          }
        },
      },
      tools: [],
    })

    const run = realtime.run()
    await registered

    await expect(
      liveWakeHandler?.({
        wakeEvent: {
          type: `inbox`,
          source: `/user/alice`,
          fromOffset: 0,
          toOffset: 0,
          eventCount: 1,
          payload: `typed while realtime is active`,
        },
        wakeOffset: `10_0`,
        ackOffset: `10_0`,
        events: [],
      })
    ).resolves.toBe(true)

    expect(sendText).toHaveBeenCalledWith(`typed while realtime is active`)
    expect(prepareAgentRun).toHaveBeenCalled()

    ctx.db.collections.manifests.insert({
      key: `document:story-outline`,
      kind: `document`,
      id: `story-outline`,
      provider: `y-durable-streams`,
      docId: `agents/worker/worker-1/documents/story-outline`,
      docPath: `agents/worker/worker-1/documents/story-outline`,
      streamPath: `/v1/yjs/default/docs/agents/worker/worker-1/documents/story-outline`,
      transportMimeType: `application/vnd.electric-agents.markdown-yjs`,
      contentMimeType: `text/markdown`,
      yTextName: `markdown`,
      title: `Story Outline`,
      createdAt: `2026-06-17T14:00:00.000Z`,
      meta: {
        sourceEntityUrl: `/worker/worker-1`,
        sourceDocumentId: `story-outline`,
      },
    })
    ctx.db.collections.manifests.insert({
      key: `document:story-act-two`,
      kind: `document`,
      id: `story-act-two`,
      provider: `y-durable-streams`,
      docId: `agents/worker/worker-2/documents/story-act-two`,
      docPath: `agents/worker/worker-2/documents/story-act-two`,
      streamPath: `/v1/yjs/default/docs/agents/worker/worker-2/documents/story-act-two`,
      transportMimeType: `application/vnd.electric-agents.markdown-yjs`,
      contentMimeType: `text/markdown`,
      yTextName: `markdown`,
      title: `Story Act Two`,
      createdAt: `2026-06-17T14:00:00.000Z`,
      meta: {
        sourceEntityUrl: `/worker/worker-2`,
        sourceDocumentId: `story-act-two`,
      },
    })

    await expect(
      liveWakeHandler?.({
        wakeEvent: {
          type: `wake`,
          source: `/horton/parent`,
          fromOffset: 0,
          toOffset: 0,
          eventCount: 2,
          payload: {
            type: `wake_batch`,
            sources: [`/worker/worker-1`, `/worker/worker-2`],
            wakes: [
              {
                source: `/worker/worker-1`,
                timeout: false,
                changes: [],
                finished_child: {
                  url: `/worker/worker-1`,
                  type: `worker`,
                  run_status: `completed`,
                  response: `The markdown document is ready.`,
                },
              },
              {
                source: `/worker/worker-2`,
                timeout: false,
                changes: [],
                finished_child: {
                  url: `/worker/worker-2`,
                  type: `worker`,
                  run_status: `completed`,
                  response: `The second markdown document is ready.`,
                },
              },
            ],
          },
        },
        wakeOffset: `11_0`,
        ackOffset: `11_0`,
        events: [],
      })
    ).resolves.toBe(true)

    expect(sendText).toHaveBeenLastCalledWith(
      expect.stringContaining(`live Electric Agents notification`)
    )
    expect(sendText).toHaveBeenLastCalledWith(
      expect.stringContaining(`The markdown document is ready.`)
    )
    expect(sendText).toHaveBeenLastCalledWith(
      expect.stringContaining(`The second markdown document is ready.`)
    )
    expect(sendText).toHaveBeenLastCalledWith(
      expect.stringContaining(`Story Outline (id: story-outline)`)
    )
    expect(sendText).toHaveBeenLastCalledWith(
      expect.stringContaining(`Story Act Two (id: story-act-two)`)
    )
    expect(sendText).toHaveBeenLastCalledWith(
      expect.stringContaining(`read_markdown_doc`)
    )

    closeProvider()
    await run
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
      model: `gpt-realtime-2`,
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
    expect(ctx.db.collections.realtimeAudioSpans.toArray).toMatchObject([
      {
        session_id: `rt-1`,
        stream: `output`,
        producer_id: `/test/entity/realtime/rt-1/audio/out`,
        seq: 0,
        byte_start: 0,
        byte_end: 3,
        byte_length: 3,
        sample_start: 0,
        sample_count: 1,
        sample_rate: 24_000,
        channels: 1,
        codec: `pcm16`,
        timing_source: `provider`,
        participant_id: `assistant`,
        provider_item_id: `item-1`,
        response_id: `resp-1`,
      },
    ])
  })

  it(`skips realtime input audio commits below the provider minimum`, async () => {
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
      model: `gpt-realtime-2`,
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

    durableMock.bodyStreams.set(
      `http://server.test/test/entity/realtime/rt-1/audio/in`,
      [new Uint8Array(2048)]
    )
    durableMock.jsonStreams.set(
      `http://server.test/test/entity/realtime/rt-1/control/in`,
      [
        { type: `input_audio.commit`, afterAudioBytes: 2048 },
        { type: `session.close`, reason: `test` },
      ]
    )

    const appendInputAudio = vi.fn()
    const clearInputAudio = vi.fn()
    const commitInputAudio = vi.fn()
    const close = vi.fn()
    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: {
        id: `test`,
        model: `test-realtime`,
        connect: async () => ({
          appendInputAudio,
          clearInputAudio,
          commitInputAudio,
          close,
          events: (async function* () {
            yield { type: `session.started` as const, sessionId: `rt-1` }
            await new Promise((resolve) => setTimeout(resolve, 20))
            yield { type: `session.closed` as const }
          })(),
        }),
      },
      tools: [],
      audio: {
        turnDetection: { type: `none` },
      },
    })

    await realtime.run()

    expect(appendInputAudio).not.toHaveBeenCalled()
    expect(clearInputAudio).toHaveBeenCalledTimes(1)
    expect(commitInputAudio).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledWith(`test`)
  })

  it(`commits only the requested realtime input audio byte range`, async () => {
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
      model: `gpt-realtime-2`,
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

    const firstTurnAudio = new Uint8Array(4800).fill(1)
    const secondTurnAudio = new Uint8Array(4800).fill(2)
    durableMock.bodyStreams.set(
      `http://server.test/test/entity/realtime/rt-1/audio/in`,
      [firstTurnAudio, secondTurnAudio]
    )
    durableMock.jsonStreams.set(
      `http://server.test/test/entity/realtime/rt-1/control/in`,
      [
        { type: `input_audio.commit`, afterAudioBytes: 4800 },
        { type: `input_audio.commit`, afterAudioBytes: 9600 },
        { type: `session.close`, reason: `test` },
      ]
    )

    const appendInputAudio = vi.fn()
    const commitInputAudio = vi.fn()
    const close = vi.fn()
    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: {
        id: `test`,
        model: `test-realtime`,
        connect: async () => ({
          appendInputAudio,
          commitInputAudio,
          close,
          events: (async function* () {
            yield { type: `session.started` as const, sessionId: `rt-1` }
            await new Promise((resolve) => setTimeout(resolve, 20))
            yield { type: `session.closed` as const }
          })(),
        }),
      },
      tools: [],
      audio: {
        turnDetection: { type: `none` },
      },
    })

    await realtime.run()

    expect(appendInputAudio).toHaveBeenNthCalledWith(1, firstTurnAudio)
    expect(appendInputAudio).toHaveBeenNthCalledWith(2, secondTurnAudio)
    expect(commitInputAudio).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledWith(`test`)
  })

  it(`streams realtime input audio directly when provider VAD is enabled`, async () => {
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
      model: `gpt-realtime-2`,
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

    const firstChunk = new Uint8Array(2048).fill(1)
    const secondChunk = new Uint8Array(2048).fill(2)
    durableMock.bodyStreams.set(
      `http://server.test/test/entity/realtime/rt-1/audio/in`,
      [firstChunk, secondChunk]
    )
    durableMock.jsonStreams.set(
      `http://server.test/test/entity/realtime/rt-1/control/in`,
      (async function* () {
        await new Promise((resolve) => setTimeout(resolve, 20))
        yield { type: `session.close`, reason: `test` }
      })()
    )

    const appendInputAudio = vi.fn()
    const commitInputAudio = vi.fn()
    const close = vi.fn()
    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: {
        id: `test`,
        model: `test-realtime`,
        connect: async () => ({
          appendInputAudio,
          commitInputAudio,
          close,
          events: (async function* () {
            yield { type: `session.started` as const, sessionId: `rt-1` }
            await new Promise((resolve) => setTimeout(resolve, 20))
            yield { type: `session.closed` as const }
          })(),
        }),
      },
      tools: [],
    })

    await realtime.run()

    expect(appendInputAudio).toHaveBeenNthCalledWith(1, firstChunk)
    expect(appendInputAudio).toHaveBeenNthCalledWith(2, secondChunk)
    expect(commitInputAudio).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledWith(`test`)
    expect(ctx.db.collections.realtimeAudioSpans.toArray).toMatchObject([
      {
        session_id: `rt-1`,
        stream: `input`,
        producer_id: `/test/entity/realtime/rt-1/audio/in`,
        seq: 0,
        byte_start: 0,
        byte_end: 4096,
        byte_length: 4096,
        sample_start: 0,
        sample_count: 2048,
        sample_rate: 24_000,
        channels: 1,
        codec: `pcm16`,
        timing_source: `runtime`,
        participant_id: `user`,
      },
    ])
  })

  it(`does not block later realtime control commands behind pending audio bytes`, async () => {
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
      model: `gpt-realtime-2`,
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

    durableMock.jsonStreams.set(
      `http://server.test/test/entity/realtime/rt-1/control/in`,
      [
        { type: `input_audio.commit`, afterAudioBytes: 9600 },
        { type: `session.close`, reason: `test` },
      ]
    )

    const commitInputAudio = vi.fn()
    const close = vi.fn()
    const realtime = ctx.useRealtime({
      systemPrompt: `You are realtime.`,
      provider: {
        id: `test`,
        model: `test-realtime`,
        connect: async () => ({
          commitInputAudio,
          close,
          events: (async function* () {
            yield { type: `session.started` as const, sessionId: `rt-1` }
            await new Promise((resolve) => setTimeout(resolve, 20))
            yield { type: `session.closed` as const }
          })(),
        }),
      },
      tools: [],
      audio: {
        turnDetection: { type: `none` },
      },
    })

    await realtime.run()

    expect(commitInputAudio).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledWith(`test`)
  })
})
