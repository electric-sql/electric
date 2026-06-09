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
            turn_detection: {
              type: `server_vad`,
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 200,
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { format: { type: `audio/pcm`, rate: 24_000 } },
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

    await session.appendInputAudio?.(new Uint8Array([1, 2, 3]))
    await session.commitInputAudio?.()

    expect(socket.sent.at(-3)).toEqual({
      type: `input_audio_buffer.append`,
      audio: `AQID`,
    })
    expect(socket.sent.at(-2)).toEqual({ type: `input_audio_buffer.commit` })
    expect(socket.sent.at(-1)).toEqual({ type: `response.create` })
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
})
