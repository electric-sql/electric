import type {
  AgentTool,
  LLMMessage,
  RealtimeAudioFormat,
  RealtimeProviderConfig,
  RealtimeProviderConnectInput,
  RealtimeProviderEvent,
  RealtimeProviderSession,
  RealtimeToolResult,
  RealtimeTurnDetectionConfig,
} from './types'
import {
  DEFAULT_OPENAI_REALTIME_MODEL,
  DEFAULT_OPENAI_REALTIME_REASONING_EFFORT,
  type OpenAIRealtimeReasoningEffort,
} from './realtime-options'

type MaybePromise<T> = T | Promise<T>
type OpenAIRealtimeSocket = {
  send: (data: string) => void
  close?: (code?: number, reason?: string) => void
  addEventListener?: (
    event: string,
    handler: (...args: Array<any>) => void
  ) => void
  removeEventListener?: (
    event: string,
    handler: (...args: Array<any>) => void
  ) => void
  on?: (event: string, handler: (...args: Array<any>) => void) => void
  off?: (event: string, handler: (...args: Array<any>) => void) => void
  readyState?: number
}
type OpenAIRealtimeWebSocketConstructor = new (
  url: string,
  init?: unknown
) => OpenAIRealtimeSocket

const DEFAULT_OPENAI_INPUT_TRANSCRIPTION_MODEL = `gpt-4o-mini-transcribe`
const BYTES_PER_PCM16_SAMPLE = 2
const MAX_INPUT_AUDIO_APPEND_BYTES = 32 * 1024

export interface OpenAIRealtimeProviderOptions {
  apiKey: string | (() => MaybePromise<string>)
  model?: string
  url?: string
  voice?: string
  reasoningEffort?: OpenAIRealtimeReasoningEffort
  safetyIdentifier?: string
  headers?: Record<string, string>
  WebSocket?: OpenAIRealtimeWebSocketConstructor
}

type OpenAIRealtimeEvent = Record<string, any> & { type?: string }

class AsyncEventQueue<T> implements AsyncIterable<T> {
  private values: Array<T> = []
  private resolvers: Array<{
    resolve: (value: IteratorResult<T>) => void
    reject: (error: unknown) => void
  }> = []
  private closed = false
  private error: unknown

  push(value: T): void {
    if (this.closed) return
    const resolver = this.resolvers.shift()
    if (resolver) {
      resolver.resolve({ value, done: false })
      return
    }
    this.values.push(value)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const resolver of this.resolvers.splice(0)) {
      resolver.resolve({ value: undefined as T, done: true })
    }
  }

  fail(error: unknown): void {
    if (this.closed) return
    this.error = error
    this.closed = true
    for (const resolver of this.resolvers.splice(0)) {
      resolver.reject(error)
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.values.length > 0) {
          return Promise.resolve({ value: this.values.shift()!, done: false })
        }
        if (this.error) {
          return Promise.reject(this.error)
        }
        if (this.closed) {
          return Promise.resolve({ value: undefined as T, done: true })
        }
        return new Promise<IteratorResult<T>>((resolve, reject) => {
          this.resolvers.push({ resolve, reject })
        })
      },
    }
  }
}

function resolveWebSocket(
  opts: OpenAIRealtimeProviderOptions
): OpenAIRealtimeWebSocketConstructor {
  const ctor = opts.WebSocket ?? globalThis.WebSocket
  if (!ctor) {
    throw new Error(
      `[agent-runtime] OpenAI realtime requires a WebSocket implementation`
    )
  }
  return ctor as unknown as OpenAIRealtimeWebSocketConstructor
}

function onSocket(
  ws: OpenAIRealtimeSocket,
  event: string,
  handler: (...args: Array<any>) => void
): void {
  if (ws.addEventListener) {
    ws.addEventListener(event, handler)
    return
  }
  ws.on?.(event, handler)
}

function socketMessageData(args: Array<any>): unknown {
  const [first] = args
  if (first && typeof first === `object` && `data` in first) {
    return (first as { data: unknown }).data
  }
  return first
}

function socketCloseDetails(args: Array<any>): {
  code?: number
  reason?: string
  wasClean?: boolean
} {
  const [first, second] = args
  if (typeof first === `number`) {
    return {
      code: first,
      reason: second === undefined ? undefined : dataToString(second),
    }
  }
  if (!first || typeof first !== `object`) return {}
  const event = first as {
    code?: unknown
    reason?: unknown
    wasClean?: unknown
  }
  return {
    code: typeof event.code === `number` ? event.code : undefined,
    reason:
      typeof event.reason === `string`
        ? event.reason
        : event.reason === undefined
          ? undefined
          : dataToString(event.reason),
    wasClean: typeof event.wasClean === `boolean` ? event.wasClean : undefined,
  }
}

function socketCloseError(details: {
  code?: number
  reason?: string
  wasClean?: boolean
}): string {
  const parts = [`OpenAI realtime WebSocket closed before client stop`]
  if (details.code !== undefined) parts.push(`code=${details.code}`)
  if (details.reason) parts.push(`reason=${details.reason}`)
  if (details.wasClean !== undefined) parts.push(`clean=${details.wasClean}`)
  return parts.join(` `)
}

function dataToString(data: unknown): string {
  if (typeof data === `string`) return data
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data)
  if (data instanceof Uint8Array) return new TextDecoder().decode(data)
  if (
    data &&
    typeof data === `object` &&
    `toString` in data &&
    typeof data.toString === `function`
  ) {
    return data.toString()
  }
  return String(data)
}

function bytesToBase64(bytes: Uint8Array): string {
  const bufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer
  if (bufferCtor) return bufferCtor.from(bytes).toString(`base64`)
  let binary = ``
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function alignedPcm16Bytes(bytes: Uint8Array): Uint8Array {
  const alignedLength =
    bytes.byteLength - (bytes.byteLength % BYTES_PER_PCM16_SAMPLE)
  if (alignedLength <= 0) return new Uint8Array()
  return alignedLength === bytes.byteLength
    ? bytes
    : bytes.subarray(0, alignedLength)
}

function inputAudioAppendChunks(bytes: Uint8Array): Array<Uint8Array> {
  const aligned = alignedPcm16Bytes(bytes)
  if (aligned.byteLength === 0) return []
  if (aligned.byteLength <= MAX_INPUT_AUDIO_APPEND_BYTES) return [aligned]

  const chunks: Array<Uint8Array> = []
  const chunkSize =
    MAX_INPUT_AUDIO_APPEND_BYTES -
    (MAX_INPUT_AUDIO_APPEND_BYTES % BYTES_PER_PCM16_SAMPLE)
  for (let offset = 0; offset < aligned.byteLength; offset += chunkSize) {
    chunks.push(aligned.subarray(offset, offset + chunkSize))
  }
  return chunks
}

function base64ToBytes(value: string): Uint8Array {
  const bufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer
  if (bufferCtor) return new Uint8Array(bufferCtor.from(value, `base64`))
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function sendJson(ws: OpenAIRealtimeSocket, event: unknown): void {
  ws.send(JSON.stringify(event))
}

function toolName(tool: AgentTool): string {
  return tool.name
}

function toOpenAITool(tool: AgentTool): Record<string, unknown> {
  return {
    type: `function`,
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }
}

function messageContentText(content: unknown): string {
  if (typeof content === `string`) return content
  if (!Array.isArray(content)) return ``
  return content
    .map((part) => {
      if (!part || typeof part !== `object`) return ``
      const text = (part as { text?: unknown }).text
      return typeof text === `string` ? text : ``
    })
    .filter(Boolean)
    .join(`\n`)
}

function messageRole(message: LLMMessage): `user` | `assistant` | null {
  const role = (message as { role?: unknown }).role
  return role === `assistant` ? `assistant` : role === `user` ? `user` : null
}

function sendConversationMessage(
  ws: OpenAIRealtimeSocket,
  message: LLMMessage
): void {
  const role = messageRole(message)
  if (!role) return
  const text = messageContentText((message as { content?: unknown }).content)
  if (!text) return
  sendJson(ws, {
    type: `conversation.item.create`,
    item: {
      type: `message`,
      role,
      content: [
        {
          type: role === `assistant` ? `output_text` : `input_text`,
          text,
        },
      ],
    },
  })
}

function realtimeFormat(
  format: RealtimeAudioFormat | undefined
): Record<string, unknown> | undefined {
  if (!format) return undefined
  return {
    type: `audio/pcm`,
    rate: format.sampleRate,
  }
}

function inputTranscription(
  input: RealtimeProviderConnectInput
): Record<string, unknown> | undefined {
  if (!input.audio?.inputFormat || input.audio.inputTranscription === false) {
    return undefined
  }
  const config = input.audio.inputTranscription ?? {}
  return {
    model: config.model ?? DEFAULT_OPENAI_INPUT_TRANSCRIPTION_MODEL,
    ...(config.language ? { language: config.language } : {}),
    ...(config.prompt ? { prompt: config.prompt } : {}),
    ...(config.delay ? { delay: config.delay } : {}),
  }
}

function realtimeTurnDetection(
  config: RealtimeTurnDetectionConfig | undefined
): Record<string, unknown> | null {
  if (config === false || config?.type === `none`) return null
  if (!config) {
    return {
      type: `server_vad`,
      threshold: 0.55,
      prefix_padding_ms: 300,
      silence_duration_ms: 500,
      create_response: true,
      interrupt_response: true,
    }
  }
  if (config.type === `semantic_vad`) {
    return {
      type: `semantic_vad`,
      ...(config.eagerness ? { eagerness: config.eagerness } : {}),
      create_response: config.createResponse ?? true,
      interrupt_response: config.interruptResponse ?? true,
    }
  }
  return {
    type: `server_vad`,
    ...(config.threshold != null ? { threshold: config.threshold } : {}),
    ...(config.prefixPaddingMs != null
      ? { prefix_padding_ms: config.prefixPaddingMs }
      : {}),
    ...(config.silenceDurationMs != null
      ? { silence_duration_ms: config.silenceDurationMs }
      : {}),
    create_response: config.createResponse ?? true,
    interrupt_response: config.interruptResponse ?? true,
  }
}

function buildSessionUpdate(
  opts: OpenAIRealtimeProviderOptions,
  input: RealtimeProviderConnectInput
): Record<string, unknown> {
  const inputFormat = realtimeFormat(input.audio?.inputFormat)
  const outputFormat = realtimeFormat(input.audio?.outputFormat)
  const transcription = inputTranscription(input)
  const model = opts.model ?? DEFAULT_OPENAI_REALTIME_MODEL
  const reasoningEffort =
    model === DEFAULT_OPENAI_REALTIME_MODEL
      ? (opts.reasoningEffort ?? DEFAULT_OPENAI_REALTIME_REASONING_EFFORT)
      : undefined
  return {
    type: `session.update`,
    session: {
      type: `realtime`,
      model,
      instructions: input.systemPrompt,
      output_modalities: outputFormat ? [`audio`] : [`text`],
      tool_choice: input.tools.length > 0 ? `auto` : `none`,
      ...(reasoningEffort ? { reasoning: { effort: reasoningEffort } } : {}),
      ...(input.tools.length > 0
        ? { tools: input.tools.map((tool) => toOpenAITool(tool)) }
        : {}),
      ...(inputFormat || outputFormat || opts.voice
        ? {
            audio: {
              ...(inputFormat
                ? {
                    input: {
                      format: inputFormat,
                      ...(transcription ? { transcription } : {}),
                      turn_detection: realtimeTurnDetection(
                        input.audio?.turnDetection
                      ),
                    },
                  }
                : {}),
              ...(outputFormat || opts.voice
                ? {
                    output: {
                      ...(outputFormat ? { format: outputFormat } : {}),
                      ...(opts.voice ? { voice: opts.voice } : {}),
                    },
                  }
                : {}),
            },
          }
        : {}),
    },
  }
}

function parseToolArgs(value: unknown): unknown {
  if (typeof value !== `string`) return value ?? {}
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function toolResultOutput(result: RealtimeToolResult): string {
  if (typeof result.result === `string`) return result.result
  return JSON.stringify(result.result)
}

type OutputTranscriptSource =
  | `response.audio_transcript`
  | `response.output_audio_transcript`
  | `response.output_text`

function outputTranscriptSource(
  event: OpenAIRealtimeEvent
): OutputTranscriptSource | undefined {
  if (
    event.type === `response.audio_transcript.delta` ||
    event.type === `response.audio_transcript.done`
  ) {
    return `response.audio_transcript`
  }
  if (
    event.type === `response.output_audio_transcript.delta` ||
    event.type === `response.output_audio_transcript.done`
  ) {
    return `response.output_audio_transcript`
  }
  if (
    event.type === `response.output_text.delta` ||
    event.type === `response.output_text.done`
  ) {
    return `response.output_text`
  }
  return undefined
}

function openAIString(value: unknown): string | undefined {
  return typeof value === `string` ? value : undefined
}

function openAINumber(value: unknown): number | undefined {
  return typeof value === `number` && Number.isFinite(value) ? value : undefined
}

function mapOpenAIEvent(
  event: OpenAIRealtimeEvent
): Array<RealtimeProviderEvent> {
  switch (event.type) {
    case `session.created`:
      return [{ type: `session.started`, sessionId: event.session?.id }]
    case `session.updated`:
      return [{ type: `session.updated` }]
    case `error`:
      return [
        {
          type: `session.error`,
          error:
            typeof event.error?.message === `string`
              ? event.error.message
              : `OpenAI realtime error`,
          code:
            typeof event.error?.code === `string`
              ? event.error.code
              : undefined,
        },
      ]
    case `input_audio_buffer.speech_started`:
      return [
        {
          type: `input_audio.speech_started`,
          audioOffset:
            typeof event.audio_start_ms === `number`
              ? String(event.audio_start_ms)
              : undefined,
          turnId: typeof event.item_id === `string` ? event.item_id : undefined,
        },
      ]
    case `input_audio_buffer.speech_stopped`:
      return [
        {
          type: `input_audio.speech_stopped`,
          audioOffset:
            typeof event.audio_end_ms === `number`
              ? String(event.audio_end_ms)
              : undefined,
          turnId: typeof event.item_id === `string` ? event.item_id : undefined,
        },
      ]
    case `input_audio_buffer.committed`:
      return [
        {
          type: `input_audio.committed`,
          turnId: openAIString(event.item_id),
          previousTurnId: openAIString(event.previous_item_id),
        },
      ]
    case `conversation.item.input_audio_transcription.delta`:
      return [
        {
          type: `input_transcript.delta`,
          delta: String(event.delta ?? ``),
          turnId: typeof event.item_id === `string` ? event.item_id : undefined,
        },
      ]
    case `conversation.item.input_audio_transcription.completed`:
      return [
        {
          type: `input_transcript.completed`,
          text: String(event.transcript ?? ``),
          turnId: typeof event.item_id === `string` ? event.item_id : undefined,
        },
      ]
    case `response.created`:
      return [
        {
          type: `response.started`,
          responseId:
            typeof event.response?.id === `string`
              ? event.response.id
              : undefined,
        },
      ]
    case `response.audio.delta`:
    case `response.output_audio.delta`:
      return [
        {
          type: `output_audio.delta`,
          audio: base64ToBytes(String(event.delta ?? ``)),
          responseId:
            typeof event.response_id === `string`
              ? event.response_id
              : undefined,
          itemId: typeof event.item_id === `string` ? event.item_id : undefined,
        },
      ]
    case `response.audio.done`:
    case `response.output_audio.done`:
      return [
        {
          type: `output_audio.completed`,
          responseId:
            typeof event.response_id === `string`
              ? event.response_id
              : undefined,
          itemId: typeof event.item_id === `string` ? event.item_id : undefined,
        },
      ]
    case `response.audio_transcript.delta`:
    case `response.output_audio_transcript.delta`:
    case `response.output_text.delta`:
      return [
        {
          type: `output_transcript.delta`,
          delta: String(event.delta ?? ``),
          responseId: openAIString(event.response_id),
          itemId: openAIString(event.item_id),
          contentIndex: openAINumber(event.content_index),
          transcriptSource: outputTranscriptSource(event),
        },
      ]
    case `response.audio_transcript.done`:
    case `response.output_audio_transcript.done`:
    case `response.output_text.done`:
      return [
        {
          type: `output_transcript.completed`,
          text:
            typeof event.transcript === `string`
              ? event.transcript
              : typeof event.text === `string`
                ? event.text
                : undefined,
          responseId: openAIString(event.response_id),
          itemId: openAIString(event.item_id),
          contentIndex: openAINumber(event.content_index),
          transcriptSource: outputTranscriptSource(event),
        },
      ]
    case `response.done`:
      return [
        {
          type: `response.completed`,
          responseId:
            typeof event.response?.id === `string`
              ? event.response.id
              : typeof event.response_id === `string`
                ? event.response_id
                : undefined,
        },
      ]
    case `response.cancelled`:
      return [
        {
          type: `response.cancelled`,
          responseId:
            typeof event.response_id === `string`
              ? event.response_id
              : undefined,
        },
      ]
    case `response.output_item.added`:
      if (event.item?.type !== `function_call`) return []
      return [
        {
          type: `tool_call.started`,
          toolCallId: String(event.item.call_id ?? event.item.id ?? ``),
          name: String(event.item.name ?? ``),
        },
      ]
    case `response.function_call_arguments.delta`:
      return [
        {
          type: `tool_call.arguments_delta`,
          toolCallId: String(event.call_id ?? event.item_id ?? ``),
          delta: String(event.delta ?? ``),
        },
      ]
    default:
      return []
  }
}

export function createOpenAIRealtimeProvider(
  opts: OpenAIRealtimeProviderOptions
): RealtimeProviderConfig {
  const model = opts.model ?? DEFAULT_OPENAI_REALTIME_MODEL

  return {
    id: `openai`,
    model,
    async connect(input): Promise<RealtimeProviderSession> {
      const apiKey =
        typeof opts.apiKey === `function` ? await opts.apiKey() : opts.apiKey
      if (!apiKey) {
        throw new Error(`[agent-runtime] OpenAI realtime apiKey is required`)
      }

      const WebSocketCtor = resolveWebSocket(opts)
      const url = new URL(opts.url ?? `wss://api.openai.com/v1/realtime`)
      url.searchParams.set(`model`, model)
      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        ...opts.headers,
      }
      if (opts.safetyIdentifier) {
        headers[`OpenAI-Safety-Identifier`] = opts.safetyIdentifier
      }

      const ws = new WebSocketCtor(url.toString(), { headers })
      const queue = new AsyncEventQueue<RealtimeProviderEvent>()
      const toolsByName = new Map(
        input.tools.map((tool) => [toolName(tool), tool])
      )
      const seenProviderEventIds = new Set<string>()
      let socketOpen = false
      let socketClosed = false
      let clientCloseRequested = false
      let responseEpoch = 0
      let rejectOpen: ((error: Error) => void) | undefined

      const closeQueue = (reason?: string): void => {
        if (socketClosed) return
        socketClosed = true
        queue.push({ type: `session.closed`, reason })
        queue.close()
        input.signal?.removeEventListener(`abort`, handleAbort)
      }

      const handleAbort = (): void => {
        const error = new Error(
          `[agent-runtime] OpenAI realtime WebSocket aborted`
        )
        clientCloseRequested = true
        closeQueue(`aborted`)
        ws.close?.(1000, `aborted`)
        if (!socketOpen) rejectOpen?.(error)
      }

      const sendToolResult = async (
        result: RealtimeToolResult
      ): Promise<void> => {
        sendJson(ws, {
          type: `conversation.item.create`,
          item: {
            type: `function_call_output`,
            call_id: result.toolCallId,
            output: toolResultOutput(result),
          },
        })
        sendJson(ws, { type: `response.create` })
      }

      const executeToolCall = async (
        event: OpenAIRealtimeEvent
      ): Promise<void> => {
        const toolResponseEpoch = responseEpoch
        const item = event.item ?? {}
        const toolCallId = String(
          event.call_id ?? item.call_id ?? item.id ?? event.item_id ?? ``
        )
        const name = String(event.name ?? item.name ?? ``)
        const args = parseToolArgs(event.arguments ?? item.arguments)
        queue.push({
          type: `tool_call.arguments_completed`,
          toolCallId,
          name,
          args,
        })
        const tool = toolsByName.get(name)
        if (!tool) {
          const result: RealtimeToolResult = {
            toolCallId,
            name,
            result: `Tool "${name}" is not available.`,
            isError: true,
          }
          queue.push({ type: `tool_call.completed`, ...result })
          await sendToolResult(result)
          return
        }

        try {
          const prepared =
            typeof tool.prepareArguments === `function`
              ? tool.prepareArguments(args)
              : args
          const result = await tool.execute(
            toolCallId,
            prepared as never,
            input.signal
          )
          const realtimeResult: RealtimeToolResult = {
            toolCallId,
            name,
            result,
          }
          queue.push({ type: `tool_call.completed`, ...realtimeResult })
          if (
            clientCloseRequested ||
            socketClosed ||
            input.signal?.aborted ||
            toolResponseEpoch !== responseEpoch
          ) {
            return
          }
          await sendToolResult(realtimeResult)
        } catch (error) {
          const realtimeResult: RealtimeToolResult = {
            toolCallId,
            name,
            result: error instanceof Error ? error.message : String(error),
            isError: true,
          }
          queue.push({ type: `tool_call.completed`, ...realtimeResult })
          if (
            clientCloseRequested ||
            socketClosed ||
            input.signal?.aborted ||
            toolResponseEpoch !== responseEpoch
          ) {
            return
          }
          await sendToolResult(realtimeResult)
        }
      }

      const opened = new Promise<void>((resolve, reject) => {
        rejectOpen = reject
        onSocket(ws, `open`, () => {
          if (socketClosed) return
          socketOpen = true
          if (input.signal?.aborted) {
            handleAbort()
            return
          }
          resolve()
        })
        onSocket(ws, `error`, (event) => {
          const error =
            event instanceof Error
              ? event
              : new Error(`[agent-runtime] OpenAI realtime WebSocket error`)
          input.signal?.removeEventListener(`abort`, handleAbort)
          queue.fail(error)
          reject(error)
        })
      })

      onSocket(ws, `message`, (...args) => {
        try {
          const parsed = JSON.parse(
            dataToString(socketMessageData(args))
          ) as OpenAIRealtimeEvent
          if (typeof parsed.event_id === `string`) {
            if (seenProviderEventIds.has(parsed.event_id)) return
            seenProviderEventIds.add(parsed.event_id)
          }
          if (parsed.type === `response.created`) {
            responseEpoch += 1
          }
          if (parsed.type === `response.function_call_arguments.done`) {
            void executeToolCall(parsed).catch((error) => queue.fail(error))
            return
          }
          for (const event of mapOpenAIEvent(parsed)) queue.push(event)
        } catch (error) {
          queue.fail(error)
        }
      })
      onSocket(ws, `close`, (...args) => {
        const details = socketCloseDetails(args)
        if (clientCloseRequested || input.signal?.aborted) {
          closeQueue(details.reason || undefined)
          return
        }
        queue.push({
          type: `session.error`,
          code: `websocket_closed`,
          error: socketCloseError(details),
        })
        closeQueue(details.reason || `websocket_closed`)
      })

      if (input.signal?.aborted) {
        handleAbort()
      } else {
        input.signal?.addEventListener(`abort`, handleAbort, { once: true })
      }

      await opened
      sendJson(ws, buildSessionUpdate(opts, input))
      for (const message of input.messages) {
        sendConversationMessage(ws, message)
      }

      return {
        events: queue,
        appendInputAudio: async (chunk) => {
          for (const appendChunk of inputAudioAppendChunks(chunk)) {
            sendJson(ws, {
              type: `input_audio_buffer.append`,
              audio: bytesToBase64(appendChunk),
            })
          }
        },
        clearInputAudio: async () => {
          sendJson(ws, { type: `input_audio_buffer.clear` })
        },
        commitInputAudio: async () => {
          sendJson(ws, { type: `input_audio_buffer.commit` })
          sendJson(ws, { type: `response.create` })
        },
        sendText: async (text) => {
          sendJson(ws, {
            type: `conversation.item.create`,
            item: {
              type: `message`,
              role: `user`,
              content: [{ type: `input_text`, text }],
            },
          })
          sendJson(ws, { type: `response.create` })
        },
        sendToolResult,
        cancelResponse: async () => {
          responseEpoch += 1
          sendJson(ws, { type: `response.cancel` })
        },
        truncateOutputAudio: async ({ itemId, audioEndMs }) => {
          sendJson(ws, {
            type: `conversation.item.truncate`,
            item_id: itemId,
            content_index: 0,
            audio_end_ms: audioEndMs,
          })
        },
        close: async (reason) => {
          clientCloseRequested = true
          closeQueue(reason)
          ws.close?.(1000, reason)
        },
      }
    },
  }
}
