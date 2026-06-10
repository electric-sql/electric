import { Type } from '@sinclair/typebox'
import { describe, expect, it, vi } from 'vitest'
import { createOpenAIRealtimeProvider } from '../src/openai-realtime'
import type { AgentTool, RealtimeProviderEvent } from '../src/types'

type Listener = (...args: Array<unknown>) => void

class FakeWebSocket {
  static instances: Array<FakeWebSocket> = []

  readonly sent: Array<unknown> = []
  readonly listeners = new Map<string, Array<Listener>>()

  constructor(
    readonly url: string,
    readonly init?: unknown
  ) {
    FakeWebSocket.instances.push(this)
    queueMicrotask(() => this.emit(`open`))
  }

  addEventListener(event: string, listener: Listener): void {
    const listeners = this.listeners.get(event) ?? []
    listeners.push(listener)
    this.listeners.set(event, listeners)
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as unknown)
  }

  close(): void {
    this.emit(`close`)
  }

  emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload)
    }
  }

  emitMessage(payload: unknown): void {
    this.emit(`message`, { data: JSON.stringify(payload) })
  }
}

function nextEvent(iterator: AsyncIterator<RealtimeProviderEvent>) {
  return iterator.next().then((result) => result.value)
}

describe(`createOpenAIRealtimeProvider`, () => {
  it(`connects over WebSocket and configures session state`, async () => {
    FakeWebSocket.instances = []
    const tool: AgentTool = {
      name: `lookup`,
      label: `Lookup`,
      description: `Look up a value`,
      parameters: Type.Object({ q: Type.String() }),
      execute: vi.fn(),
    }
    const provider = createOpenAIRealtimeProvider({
      apiKey: `sk-test`,
      voice: `marin`,
      reasoningEffort: `medium`,
      safetyIdentifier: `user-1`,
      WebSocket: FakeWebSocket,
    })

    await provider.connect({
      systemPrompt: `You are Horton.`,
      messages: [{ role: `user`, content: `Previous context` } as never],
      tools: [tool],
      audio: {
        inputFormat: { codec: `pcm16`, sampleRate: 24_000, channels: 1 },
        outputFormat: { codec: `pcm16`, sampleRate: 24_000, channels: 1 },
      },
    })

    const socket = FakeWebSocket.instances[0]!
    expect(socket.url).toBe(
      `wss://api.openai.com/v1/realtime?model=gpt-realtime-2`
    )
    expect(socket.init).toEqual({
      headers: {
        Authorization: `Bearer sk-test`,
        'OpenAI-Safety-Identifier': `user-1`,
      },
    })
    expect(socket.sent[0]).toMatchObject({
      type: `session.update`,
      session: {
        type: `realtime`,
        model: `gpt-realtime-2`,
        instructions: `You are Horton.`,
        reasoning: { effort: `medium` },
        output_modalities: [`audio`],
        tool_choice: `auto`,
        tools: [
          {
            type: `function`,
            name: `lookup`,
            description: `Look up a value`,
          },
        ],
        audio: {
          input: {
            format: { type: `audio/pcm`, rate: 24_000 },
            transcription: { model: `gpt-4o-mini-transcribe` },
            turn_detection: {
              type: `server_vad`,
              threshold: 0.55,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            format: { type: `audio/pcm`, rate: 24_000 },
            voice: `marin`,
          },
        },
      },
    })
    expect(socket.sent[1]).toEqual({
      type: `conversation.item.create`,
      item: {
        type: `message`,
        role: `user`,
        content: [{ type: `input_text`, text: `Previous context` }],
      },
    })
  })

  it(`does not send reasoning effort to non-reasoning realtime models`, async () => {
    FakeWebSocket.instances = []
    const provider = createOpenAIRealtimeProvider({
      apiKey: `sk-test`,
      model: `gpt-realtime-1.5`,
      reasoningEffort: `low`,
      WebSocket: FakeWebSocket,
    })

    await provider.connect({
      systemPrompt: `You are Horton.`,
      messages: [],
      tools: [],
      audio: {
        outputFormat: { codec: `pcm16`, sampleRate: 24_000, channels: 1 },
      },
    })

    const socket = FakeWebSocket.instances[0]!
    expect((socket.sent[0] as any).session.reasoning).toBeUndefined()
  })

  it(`can disable input audio transcription`, async () => {
    FakeWebSocket.instances = []
    const provider = createOpenAIRealtimeProvider({
      apiKey: `sk-test`,
      WebSocket: FakeWebSocket,
    })

    await provider.connect({
      systemPrompt: `Talk`,
      messages: [],
      tools: [],
      audio: {
        inputFormat: { codec: `pcm16`, sampleRate: 24_000, channels: 1 },
        inputTranscription: false,
      },
    })

    const socket = FakeWebSocket.instances[0]!
    expect(socket.sent[0]).toMatchObject({
      session: {
        audio: {
          input: {
            format: { type: `audio/pcm`, rate: 24_000 },
          },
        },
      },
    })
    expect(
      (socket.sent[0] as any).session.audio.input.transcription
    ).toBeUndefined()
  })

  it(`maps input transcription delay for low latency captions`, async () => {
    FakeWebSocket.instances = []
    const provider = createOpenAIRealtimeProvider({
      apiKey: `sk-test`,
      WebSocket: FakeWebSocket,
    })

    await provider.connect({
      systemPrompt: `Talk`,
      messages: [],
      tools: [],
      audio: {
        inputFormat: { codec: `pcm16`, sampleRate: 24_000, channels: 1 },
        inputTranscription: {
          model: `gpt-realtime-whisper`,
          delay: `minimal`,
        },
      },
    })

    const socket = FakeWebSocket.instances[0]!
    expect(socket.sent[0]).toMatchObject({
      session: {
        audio: {
          input: {
            transcription: {
              model: `gpt-realtime-whisper`,
              delay: `minimal`,
            },
          },
        },
      },
    })
  })

  it(`can disable realtime turn detection for manual audio commits`, async () => {
    FakeWebSocket.instances = []
    const provider = createOpenAIRealtimeProvider({
      apiKey: `sk-test`,
      WebSocket: FakeWebSocket,
    })

    await provider.connect({
      systemPrompt: `Talk`,
      messages: [],
      tools: [],
      audio: {
        inputFormat: { codec: `pcm16`, sampleRate: 24_000, channels: 1 },
        turnDetection: { type: `none` },
      },
    })

    const socket = FakeWebSocket.instances[0]!
    expect(socket.sent[0]).toMatchObject({
      session: {
        audio: {
          input: {
            turn_detection: null,
          },
        },
      },
    })
  })

  it(`maps realtime server VAD configuration`, async () => {
    FakeWebSocket.instances = []
    const provider = createOpenAIRealtimeProvider({
      apiKey: `sk-test`,
      WebSocket: FakeWebSocket,
    })

    await provider.connect({
      systemPrompt: `Talk`,
      messages: [],
      tools: [],
      audio: {
        inputFormat: { codec: `pcm16`, sampleRate: 24_000, channels: 1 },
        turnDetection: {
          type: `server_vad`,
          threshold: 0.7,
          prefixPaddingMs: 250,
          silenceDurationMs: 650,
          createResponse: false,
          interruptResponse: false,
        },
      },
    })

    const socket = FakeWebSocket.instances[0]!
    expect(socket.sent[0]).toMatchObject({
      session: {
        audio: {
          input: {
            turn_detection: {
              type: `server_vad`,
              threshold: 0.7,
              prefix_padding_ms: 250,
              silence_duration_ms: 650,
              create_response: false,
              interrupt_response: false,
            },
          },
        },
      },
    })
  })

  it(`sends audio input chunks as OpenAI input buffer events`, async () => {
    FakeWebSocket.instances = []
    const provider = createOpenAIRealtimeProvider({
      apiKey: `sk-test`,
      WebSocket: FakeWebSocket,
    })

    const session = await provider.connect({
      systemPrompt: `Talk`,
      messages: [],
      tools: [],
    })
    const socket = FakeWebSocket.instances[0]!

    await session.appendInputAudio?.(new Uint8Array([1, 2, 3, 4]))
    await session.clearInputAudio?.()
    await session.commitInputAudio?.()

    expect(socket.sent.at(-4)).toEqual({
      type: `input_audio_buffer.append`,
      audio: `AQIDBA==`,
    })
    expect(socket.sent.at(-3)).toEqual({ type: `input_audio_buffer.clear` })
    expect(socket.sent.at(-2)).toEqual({ type: `input_audio_buffer.commit` })
    expect(socket.sent.at(-1)).toEqual({ type: `response.create` })
  })

  it(`normalizes audio input chunks before appending them`, async () => {
    FakeWebSocket.instances = []
    const provider = createOpenAIRealtimeProvider({
      apiKey: `sk-test`,
      WebSocket: FakeWebSocket,
    })

    const session = await provider.connect({
      systemPrompt: `Talk`,
      messages: [],
      tools: [],
    })
    const socket = FakeWebSocket.instances[0]!

    await session.appendInputAudio?.(new Uint8Array())
    await session.appendInputAudio?.(new Uint8Array([1]))
    await session.appendInputAudio?.(new Uint8Array([1, 2, 3]))

    const large = new Uint8Array(32 * 1024 + 4)
    large.fill(7)
    await session.appendInputAudio?.(large)

    const appendEvents = socket.sent.filter(
      (event): event is { type: string; audio: string } =>
        typeof event === `object` &&
        event !== null &&
        (event as { type?: unknown }).type === `input_audio_buffer.append`
    )
    expect(appendEvents).toHaveLength(3)
    expect(appendEvents[0]!.audio).toBe(`AQI=`)
    expect(Buffer.from(appendEvents[1]!.audio, `base64`)).toHaveLength(
      32 * 1024
    )
    expect(Buffer.from(appendEvents[2]!.audio, `base64`)).toHaveLength(4)
  })

  it(`unblocks the event stream when the run signal aborts`, async () => {
    FakeWebSocket.instances = []
    const controller = new AbortController()
    const provider = createOpenAIRealtimeProvider({
      apiKey: `sk-test`,
      WebSocket: FakeWebSocket,
    })

    const session = await provider.connect({
      systemPrompt: `Talk`,
      messages: [],
      tools: [],
      signal: controller.signal,
    })
    const iterator = session.events[Symbol.asyncIterator]()

    controller.abort()

    await expect(nextEvent(iterator)).resolves.toEqual({
      type: `session.closed`,
      reason: `aborted`,
    })
  })

  it(`surfaces unexpected WebSocket closes as provider errors`, async () => {
    FakeWebSocket.instances = []
    const provider = createOpenAIRealtimeProvider({
      apiKey: `sk-test`,
      WebSocket: FakeWebSocket,
    })

    const session = await provider.connect({
      systemPrompt: `Talk`,
      messages: [],
      tools: [],
    })
    const socket = FakeWebSocket.instances[0]!
    const iterator = session.events[Symbol.asyncIterator]()

    socket.emit(`close`, { code: 1008, reason: `invalid model` })

    await expect(nextEvent(iterator)).resolves.toEqual({
      type: `session.error`,
      code: `websocket_closed`,
      error:
        `OpenAI realtime WebSocket closed before client stop ` +
        `code=1008 reason=invalid model`,
    })
  })

  it(`can truncate output audio for interrupted playback`, async () => {
    FakeWebSocket.instances = []
    const provider = createOpenAIRealtimeProvider({
      apiKey: `sk-test`,
      WebSocket: FakeWebSocket,
    })

    const session = await provider.connect({
      systemPrompt: `Talk`,
      messages: [],
      tools: [],
    })
    const socket = FakeWebSocket.instances[0]!

    await session.truncateOutputAudio?.({
      itemId: `item-1`,
      audioEndMs: 320,
    })

    expect(socket.sent.at(-1)).toEqual({
      type: `conversation.item.truncate`,
      item_id: `item-1`,
      content_index: 0,
      audio_end_ms: 320,
    })
  })

  it(`maps GA output audio and transcript events`, async () => {
    FakeWebSocket.instances = []
    const provider = createOpenAIRealtimeProvider({
      apiKey: `sk-test`,
      WebSocket: FakeWebSocket,
    })

    const session = await provider.connect({
      systemPrompt: `Talk`,
      messages: [],
      tools: [],
    })
    const socket = FakeWebSocket.instances[0]!
    const iterator = session.events[Symbol.asyncIterator]()

    socket.emitMessage({
      type: `response.output_audio.delta`,
      response_id: `resp-1`,
      item_id: `item-1`,
      delta: `AQID`,
    })
    await expect(nextEvent(iterator)).resolves.toEqual({
      type: `output_audio.delta`,
      responseId: `resp-1`,
      itemId: `item-1`,
      audio: new Uint8Array([1, 2, 3]),
    })

    socket.emitMessage({
      type: `response.output_audio_transcript.delta`,
      response_id: `resp-1`,
      item_id: `item-1`,
      content_index: 0,
      delta: `hello`,
    })
    await expect(nextEvent(iterator)).resolves.toEqual({
      type: `output_transcript.delta`,
      responseId: `resp-1`,
      itemId: `item-1`,
      contentIndex: 0,
      transcriptSource: `response.output_audio_transcript`,
      delta: `hello`,
    })

    socket.emitMessage({
      type: `response.output_audio.done`,
      response_id: `resp-1`,
      item_id: `item-1`,
    })
    await expect(nextEvent(iterator)).resolves.toEqual({
      type: `output_audio.completed`,
      responseId: `resp-1`,
      itemId: `item-1`,
    })
  })

  it(`maps GA input audio transcript events`, async () => {
    FakeWebSocket.instances = []
    const provider = createOpenAIRealtimeProvider({
      apiKey: `sk-test`,
      WebSocket: FakeWebSocket,
    })

    const session = await provider.connect({
      systemPrompt: `Talk`,
      messages: [],
      tools: [],
    })
    const socket = FakeWebSocket.instances[0]!
    const iterator = session.events[Symbol.asyncIterator]()

    socket.emitMessage({
      type: `input_audio_buffer.speech_started`,
      item_id: `item-1`,
      audio_start_ms: 120,
    })
    await expect(nextEvent(iterator)).resolves.toEqual({
      type: `input_audio.speech_started`,
      turnId: `item-1`,
      audioOffset: `120`,
    })

    socket.emitMessage({
      type: `input_audio_buffer.speech_stopped`,
      item_id: `item-1`,
      audio_end_ms: 860,
    })
    await expect(nextEvent(iterator)).resolves.toEqual({
      type: `input_audio.speech_stopped`,
      turnId: `item-1`,
      audioOffset: `860`,
    })

    socket.emitMessage({
      type: `input_audio_buffer.committed`,
      item_id: `item-1`,
      previous_item_id: `previous-item`,
    })
    await expect(nextEvent(iterator)).resolves.toEqual({
      type: `input_audio.committed`,
      turnId: `item-1`,
      previousTurnId: `previous-item`,
    })

    socket.emitMessage({
      type: `conversation.item.input_audio_transcription.delta`,
      item_id: `item-1`,
      delta: `hello`,
    })
    await expect(nextEvent(iterator)).resolves.toEqual({
      type: `input_transcript.delta`,
      turnId: `item-1`,
      delta: `hello`,
    })

    socket.emitMessage({
      type: `conversation.item.input_audio_transcription.completed`,
      item_id: `item-1`,
      transcript: `hello there`,
    })
    await expect(nextEvent(iterator)).resolves.toEqual({
      type: `input_transcript.completed`,
      turnId: `item-1`,
      text: `hello there`,
    })
  })

  it(`maps OpenAI events and executes function calls`, async () => {
    FakeWebSocket.instances = []
    const execute = vi.fn().mockResolvedValue({
      content: [{ type: `text`, text: `done` }],
      details: { ok: true },
    })
    const tool: AgentTool = {
      name: `lookup`,
      label: `Lookup`,
      description: `Look up a value`,
      parameters: Type.Object({ q: Type.String() }),
      execute,
    }
    const provider = createOpenAIRealtimeProvider({
      apiKey: `sk-test`,
      WebSocket: FakeWebSocket,
    })

    const session = await provider.connect({
      systemPrompt: `Talk`,
      messages: [],
      tools: [tool],
    })
    const socket = FakeWebSocket.instances[0]!
    const iterator = session.events[Symbol.asyncIterator]()

    socket.emitMessage({ type: `session.created`, session: { id: `sess-1` } })
    await expect(nextEvent(iterator)).resolves.toEqual({
      type: `session.started`,
      sessionId: `sess-1`,
    })

    socket.emitMessage({
      type: `response.output_item.added`,
      item: {
        type: `function_call`,
        id: `fc-1`,
        call_id: `call-1`,
        name: `lookup`,
      },
    })
    await expect(nextEvent(iterator)).resolves.toEqual({
      type: `tool_call.started`,
      toolCallId: `call-1`,
      name: `lookup`,
    })

    socket.emitMessage({
      type: `response.function_call_arguments.done`,
      call_id: `call-1`,
      name: `lookup`,
      arguments: JSON.stringify({ q: `status` }),
    })

    await expect(nextEvent(iterator)).resolves.toEqual({
      type: `tool_call.arguments_completed`,
      toolCallId: `call-1`,
      name: `lookup`,
      args: { q: `status` },
    })
    await expect(nextEvent(iterator)).resolves.toMatchObject({
      type: `tool_call.completed`,
      toolCallId: `call-1`,
      name: `lookup`,
    })
    expect(execute).toHaveBeenCalledWith(`call-1`, { q: `status` }, undefined)
    expect(socket.sent.at(-2)).toMatchObject({
      type: `conversation.item.create`,
      item: {
        type: `function_call_output`,
        call_id: `call-1`,
      },
    })
    expect(socket.sent.at(-1)).toEqual({ type: `response.create` })
  })

  it(`does not send tool results for a cancelled response`, async () => {
    FakeWebSocket.instances = []
    let resolveTool: (value: {
      content: Array<{ type: `text`; text: string }>
      details: Record<string, unknown>
    }) => void = () => undefined
    const execute = vi.fn(
      () =>
        new Promise<{
          content: Array<{ type: `text`; text: string }>
          details: Record<string, unknown>
        }>((resolve) => {
          resolveTool = resolve
        })
    )
    const tool: AgentTool = {
      name: `lookup`,
      label: `Lookup`,
      description: `Look up a value`,
      parameters: Type.Object({ q: Type.String() }),
      execute,
    }
    const provider = createOpenAIRealtimeProvider({
      apiKey: `sk-test`,
      WebSocket: FakeWebSocket,
    })

    const session = await provider.connect({
      systemPrompt: `Talk`,
      messages: [],
      tools: [tool],
    })
    const socket = FakeWebSocket.instances[0]!
    const iterator = session.events[Symbol.asyncIterator]()

    socket.emitMessage({ type: `response.created`, response: { id: `resp-1` } })
    await expect(nextEvent(iterator)).resolves.toEqual({
      type: `response.started`,
      responseId: `resp-1`,
    })

    socket.emitMessage({
      type: `response.function_call_arguments.done`,
      call_id: `call-1`,
      name: `lookup`,
      arguments: JSON.stringify({ q: `status` }),
    })
    await expect(nextEvent(iterator)).resolves.toMatchObject({
      type: `tool_call.arguments_completed`,
      toolCallId: `call-1`,
    })
    expect(execute).toHaveBeenCalledWith(`call-1`, { q: `status` }, undefined)

    await session.cancelResponse?.()
    resolveTool({ content: [{ type: `text`, text: `done` }], details: {} })

    await expect(nextEvent(iterator)).resolves.toMatchObject({
      type: `tool_call.completed`,
      toolCallId: `call-1`,
    })
    expect(socket.sent).toContainEqual({ type: `response.cancel` })
    expect(socket.sent).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: `conversation.item.create`,
          item: expect.objectContaining({
            type: `function_call_output`,
            call_id: `call-1`,
          }),
        }),
      ])
    )
  })
})
