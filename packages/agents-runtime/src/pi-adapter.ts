/**
 * Pi-agent-core adapter — maps pi-agent-core events to State Protocol writes.
 *
 * Responsibilities:
 * - Context translation (LLMMessage[] → AgentMessage[])
 * - Event subscription with async write queue (pi-agent emits synchronously)
 * - Delegating ID management and event writing to OutboundBridge
 */

import { Agent } from '@mariozechner/pi-agent-core'
import { getModel } from '@mariozechner/pi-ai'
import { createOutboundBridge } from './outbound-bridge'
import { MOONSHOT_PROVIDER, getMoonshotModel } from './moonshot-models'
import { runtimeLog } from './log'
import type { OutboundIdSeed } from './outbound-bridge'
import type { ChangeEvent } from '@durable-streams/state'
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  StreamFn,
} from '@mariozechner/pi-agent-core'
import type {
  KnownProvider,
  Model,
  Provider,
  SimpleStreamOptions,
} from '@mariozechner/pi-ai'
import type { LLMContentBlock, LLMMessage, LLMMessageContent } from './types'

/**
 * Split a streamed reasoning blob into `{ title, body }`.
 *
 * OpenAI's Responses API surfaces reasoning summaries with a bolded
 * first line — `**Inspecting PR workflow**\n\n<body>` — which we want
 * to drive a separate heading in the UI rather than render inline.
 * Anthropic / DeepSeek-R1 / Moonshot K2 don't emit titles; for them
 * the regex doesn't match and `title` stays `null`.
 *
 * Match is anchored to the start, requires a blank-line terminator
 * (so partial titles mid-stream don't get prematurely promoted), and
 * forbids `*` or newline inside the title (so we don't accidentally
 * eat bolded emphasis later in the text).
 */
function parseReasoningSummary(text: string): {
  title: string | null
  body: string
} {
  const content = text.trim()
  const match = content.match(/^\*\*([^*\n]+)\*\*(?:\r?\n\r?\n|$)/)
  if (!match) return { title: null, body: content }
  return {
    title: match[1]!.trim(),
    body: content.slice(match[0].length).trimEnd(),
  }
}

// ============================================================================
// Options
// ============================================================================

export interface PiAdapterOptions {
  systemPrompt: string
  model: string | Model<any>
  provider?: Provider
  tools: Array<AgentTool>
  streamFn?: StreamFn
  getApiKey?: (
    provider: string
  ) => Promise<string | undefined> | string | undefined
  onPayload?: SimpleStreamOptions[`onPayload`]
}

interface PiAgentAdapterConfig {
  entityUrl: string
  epoch: number
  messages: Array<LLMMessage>
  outboundIdSeed: OutboundIdSeed
  writeEvent: (event: ChangeEvent) => void
}

interface PiAgentHandle {
  run: (input?: string, abortSignal?: AbortSignal) => Promise<void>
  steer: (message: string) => void
  isRunning: () => boolean
  abort: () => void
  dispose: () => void
}

type PiAgentAdapterFactory = (config: PiAgentAdapterConfig) => PiAgentHandle

export function resolvePiModel(opts: {
  model: string | Model<any>
  provider?: Provider
}): Model<any> {
  if (typeof opts.model !== `string`) {
    return opts.model
  }

  const provider = opts.provider ?? `anthropic`
  const model =
    provider === MOONSHOT_PROVIDER
      ? getMoonshotModel(opts.model)
      : getModel(
          provider as KnownProvider,
          opts.model as Parameters<typeof getModel>[1]
        )

  if (!model) {
    throw new Error(
      `[agent-runtime] Unknown model "${opts.model}" for provider "${provider}"`
    )
  }

  return model
}

// ============================================================================
// Context Translation
// ============================================================================

function toAgentContentBlock(block: LLMContentBlock): unknown {
  if (block.type === `text`) {
    return { type: `text`, text: block.text }
  }
  if (block.type === `image`) {
    return { type: `image`, data: block.data, mimeType: block.mimeType }
  }

  return {
    type: `text`,
    text: `[attachment omitted: id=${block.id}]`,
  }
}

function toAgentContent(content: LLMMessageContent): Array<unknown> {
  if (typeof content === `string`) {
    return [{ type: `text`, text: content }]
  }
  return content.map(toAgentContentBlock)
}

export function toAgentHistory(
  messages: Array<LLMMessage>
): Array<AgentMessage> {
  const history: Array<AgentMessage> = []
  const toolNamesById = new Map<string, string>()

  const lastAssistant = (): AgentMessage | undefined => {
    const last = history[history.length - 1]
    return last?.role === `assistant` ? last : undefined
  }

  for (const message of messages) {
    switch (message.role) {
      case `user`:
        history.push({
          role: `user`,
          content: toAgentContent(message.content),
          timestamp: Date.now(),
        } as AgentMessage)
        break

      case `assistant`: {
        const prev = lastAssistant()
        const content = toAgentContent(message.content) as Array<{
          type: string
          text?: string
        }>

        if (prev) {
          const prevContent = prev.content as Array<{
            type: string
            text?: string
          }>
          const lastBlock = prevContent[prevContent.length - 1]
          const firstBlock = content[0]

          if (lastBlock?.type === `text` && firstBlock?.type === `text`) {
            lastBlock.text = `${lastBlock.text ?? ``}${firstBlock.text ?? ``}`
            prevContent.push(...content.slice(1))
          } else {
            prevContent.push(...content)
          }
        } else {
          history.push({
            role: `assistant`,
            content,
            timestamp: Date.now(),
          } as AgentMessage)
        }
        break
      }

      case `tool_call`: {
        toolNamesById.set(message.toolCallId, message.toolName)
        const block = {
          type: `toolCall`,
          id: message.toolCallId,
          name: message.toolName,
          arguments:
            (message.toolArgs as Record<string, unknown> | undefined) ?? {},
        }
        const prev = lastAssistant()
        if (prev) {
          ;(prev.content as Array<unknown>).push(block)
        } else {
          history.push({
            role: `assistant`,
            content: [block],
            timestamp: Date.now(),
          } as AgentMessage)
        }
        break
      }

      case `tool_result`:
        history.push({
          role: `toolResult`,
          toolCallId: message.toolCallId,
          toolName: toolNamesById.get(message.toolCallId) ?? ``,
          content: toAgentContent(message.content),
          isError: message.isError,
          timestamp: Date.now(),
        } as AgentMessage)
        break
    }
  }

  return history
}

// ============================================================================
// Adapter Factory
// ============================================================================

export function createPiAgentAdapter(
  opts: PiAdapterOptions
): PiAgentAdapterFactory {
  return (config: PiAgentAdapterConfig): PiAgentHandle => {
    const bridge = createOutboundBridge(
      config.outboundIdSeed,
      config.writeEvent
    )
    const history = toAgentHistory(config.messages)

    let running = false
    let disposed = false
    let stepStartTime = 0
    let textStarted = false
    let reasoningStarted = false
    let reasoningAccum = ``
    let abortedRun = false

    const model = resolvePiModel({
      model: opts.model,
      ...(opts.provider && { provider: opts.provider }),
    })

    const agent = new Agent({
      initialState: {
        systemPrompt: opts.systemPrompt,
        tools: opts.tools as Array<never>,
        messages: history as Array<never>,
        model,
      },
      ...(opts.streamFn && { streamFn: opts.streamFn }),
      ...(opts.getApiKey && { getApiKey: opts.getApiKey }),
      ...(opts.onPayload && { onPayload: opts.onPayload }),
    })

    function processAgentEvents(
      resolveWhenDone: () => void,
      rejectOnError: (err: Error) => void
    ): () => void {
      const eventQueue: Array<AgentEvent> = []
      let processing = false
      let consuming = true
      let done = false
      const eventCounts: Record<string, number> = {}
      let textDeltaCount = 0
      const logPrefix = `[${config.entityUrl}]`

      const processQueue = (): void => {
        if (!consuming || processing || eventQueue.length === 0) return
        processing = true

        while (consuming && eventQueue.length > 0) {
          const event = eventQueue.shift()!
          eventCounts[event.type] = (eventCounts[event.type] ?? 0) + 1

          if (disposed) {
            processing = false
            return
          }

          try {
            switch (event.type) {
              case `agent_start`: {
                break
              }

              case `message_start`: {
                stepStartTime = Date.now()
                textStarted = false
                reasoningStarted = false
                reasoningAccum = ``
                bridge.onStepStart({
                  modelProvider: model.provider,
                  modelId: model.id,
                })
                break
              }

              case `message_update`: {
                const assistantEvent = (event as Record<string, unknown>)
                  .assistantMessageEvent as
                  | { type: string; delta?: string }
                  | undefined
                if (assistantEvent?.type === `text_delta`) {
                  if (!textStarted) {
                    textStarted = true
                    bridge.onTextStart()
                  }
                  bridge.onTextDelta(assistantEvent.delta ?? ``)
                  textDeltaCount++
                } else if (assistantEvent?.type === `thinking_start`) {
                  // Open a reasoning row even if no delta arrives — some
                  // providers emit an empty thinking block (e.g. when
                  // reasoning is gated to a level the model didn't use).
                  // We close it on `thinking_end` regardless.
                  if (!reasoningStarted) {
                    reasoningStarted = true
                    reasoningAccum = ``
                    bridge.onReasoningStart()
                  }
                } else if (assistantEvent?.type === `thinking_delta`) {
                  // Defensive: providers occasionally emit the first
                  // delta without a matching `thinking_start`. Open the
                  // row lazily so we don't drop the chunk.
                  if (!reasoningStarted) {
                    reasoningStarted = true
                    reasoningAccum = ``
                    bridge.onReasoningStart()
                  }
                  const delta = assistantEvent.delta ?? ``
                  reasoningAccum += delta
                  bridge.onReasoningDelta(delta)
                } else if (assistantEvent?.type === `thinking_end`) {
                  if (reasoningStarted) {
                    // Parse a bolded `**Title**\n\n` prefix once, here,
                    // so the UI can drive a heading without re-parsing on
                    // every render. Only OpenAI's Responses API emits
                    // these today (Anthropic / DeepSeek don't); the
                    // helper returns no title for un-titled streams.
                    const { title } = parseReasoningSummary(reasoningAccum)
                    bridge.onReasoningEnd(
                      title !== null ? { summaryTitle: title } : undefined
                    )
                    reasoningStarted = false
                    reasoningAccum = ``
                  }
                } else {
                  runtimeLog.debug(
                    logPrefix,
                    `pi-adapter message_update non-text type=${assistantEvent?.type ?? `undefined`}`
                  )
                }
                break
              }

              case `message_end`: {
                const msg = (event as Record<string, unknown>).message as
                  | {
                      content?: Array<{ type: string; text?: string }>
                      usage?: Record<string, number>
                      stopReason?: string
                      errorMessage?: string
                    }
                  | undefined

                const isError =
                  msg?.stopReason === `error` ||
                  (!!msg?.errorMessage && msg.stopReason !== `aborted`)
                const isAborted = msg?.stopReason === `aborted`
                if (isAborted) {
                  abortedRun = true
                }

                if (isError) {
                  runtimeLog.error(
                    logPrefix,
                    `pi-adapter message_end ERROR stopReason=${msg.stopReason ?? `none`} ` +
                      `errorMessage=${msg.errorMessage ?? `none`}`
                  )
                } else {
                  runtimeLog.debug(
                    logPrefix,
                    `pi-adapter message_end stopReason=${msg?.stopReason ?? `none`} ` +
                      `contentTypes=${(msg?.content ?? []).map((c) => c.type).join(`,`) || `none`} ` +
                      `usage=${JSON.stringify(msg?.usage ?? {})}`
                  )
                }

                if (textStarted) {
                  bridge.onTextEnd()
                  textStarted = false
                }
                if (reasoningStarted) {
                  // Provider closed the message without an explicit
                  // `thinking_end` (rare, but seen on aborts / errors).
                  // Close the open reasoning row with whatever title we
                  // can salvage from the accumulator so it doesn't sit
                  // forever in `streaming` state.
                  const { title } = parseReasoningSummary(reasoningAccum)
                  bridge.onReasoningEnd(
                    title !== null ? { summaryTitle: title } : undefined
                  )
                  reasoningStarted = false
                  reasoningAccum = ``
                }

                const usage = msg?.usage
                const hasToolCalls = msg?.content?.some(
                  (c) => c.type === `toolUse` || c.type === `toolCall`
                )
                const finishReason = isError
                  ? `error`
                  : isAborted
                    ? `aborted`
                    : hasToolCalls
                      ? `tool_calls`
                      : `stop`
                bridge.onStepEnd({
                  finishReason,
                  durationMs: Date.now() - stepStartTime,
                  ...(usage && {
                    tokenInput: usage.input ?? usage.inputTokens ?? 0,
                    tokenOutput: usage.output ?? usage.outputTokens ?? 0,
                  }),
                })

                if (isError) {
                  throw new Error(
                    `pi-agent message_end error: ${msg.errorMessage ?? `unknown error`} (stopReason=${msg.stopReason ?? `none`})`
                  )
                }
                break
              }

              case `tool_execution_start`: {
                bridge.onToolCallStart(
                  event.toolCallId,
                  event.toolName,
                  event.args
                )
                break
              }

              case `tool_execution_end`: {
                bridge.onToolCallEnd(
                  event.toolCallId,
                  event.toolName,
                  event.result,
                  event.isError
                )
                break
              }

              case `agent_end`: {
                bridge.onRunEnd({
                  finishReason: abortedRun ? `aborted` : `stop`,
                })
                runtimeLog.debug(
                  logPrefix,
                  `pi-adapter agent_end textDeltas=${textDeltaCount} ` +
                    `eventCounts=${JSON.stringify(eventCounts)}`
                )
                done = true
                break
              }
            }
          } catch (err) {
            rejectOnError(err as Error)
            return
          }
        }

        processing = false
        if (consuming && done) {
          running = false
          resolveWhenDone()
        }
      }

      const unsubscribe = agent.subscribe((event: AgentEvent) => {
        if (!consuming) return
        eventQueue.push(event)
        processQueue()
      })

      return () => {
        consuming = false
        eventQueue.length = 0
        unsubscribe()
      }
    }

    return {
      async run(input?: string, abortSignal?: AbortSignal): Promise<void> {
        running = true
        abortedRun = false

        bridge.onRunStart()

        return new Promise<void>((resolve, reject) => {
          let settled = false
          let unsubscribe = (): void => {}
          let abortFallback: ReturnType<typeof setTimeout> | null = null
          const clearAbortFallback = (): void => {
            if (!abortFallback) return
            clearTimeout(abortFallback)
            abortFallback = null
          }
          const finish = (finishReason: `stop` | `aborted` | `error`): void => {
            if (settled) return
            settled = true
            clearAbortFallback()
            running = false
            abortSignal?.removeEventListener(`abort`, abortRun)
            unsubscribe()
            bridge.onRunEnd({ finishReason })
          }
          const abortRun = (): void => {
            if (settled) return
            abortedRun = true
            agent.abort()

            // Let pi-agent-core settle synchronous abort events first. If the
            // provider/tool ignores AbortSignal and emits nothing, close the
            // run on the next macrotask so callers are not left waiting.
            abortFallback ??= setTimeout(() => {
              finish(`aborted`)
              resolve()
            }, 0)
          }
          unsubscribe = processAgentEvents(
            () => {
              if (settled) return
              settled = true
              running = false
              clearAbortFallback()
              abortSignal?.removeEventListener(`abort`, abortRun)
              unsubscribe()
              resolve()
            },
            (err) => {
              if (settled) return
              finish(`error`)
              reject(err)
            }
          )

          abortSignal?.addEventListener(`abort`, abortRun, { once: true })
          const runPromise =
            input !== undefined ? agent.prompt(input) : agent.continue()
          if (abortSignal?.aborted) {
            abortRun()
          }

          Promise.resolve(runPromise).catch((err: Error) => {
            if (settled) return
            if (abortedRun) return
            finish(`error`)
            reject(err)
          })
        })
      },

      steer(message: string): void {
        agent.steer({
          role: `user`,
          content: [{ type: `text`, text: message }],
          timestamp: Date.now(),
        })
      },

      isRunning(): boolean {
        return running
      },

      abort(): void {
        agent.abort()
      },

      dispose(): void {
        disposed = true
        agent.abort()
        running = false
      },
    }
  }
}
