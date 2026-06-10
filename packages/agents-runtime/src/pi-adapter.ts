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
  // Invoked after each step ends with the input/output tokens reported by the
  // provider. Used by goal-budget enforcement to abort mid-run.
  onStepEnd?: (stats: { input: number; output: number }) => void
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
      config.writeEvent,
      opts.onStepEnd ? { onStepEnd: opts.onStepEnd } : undefined
    )
    const history = toAgentHistory(config.messages)

    let running = false
    let disposed = false
    let stepStartTime = 0
    let textStarted = false
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
                // pi-ai's `Usage` splits the input side across three
                // counters: `input` (new uncached tokens this turn),
                // `cacheRead` (prompt-cache hits — typically the
                // system prompt + prior history once the cache is
                // warm) and `cacheWrite` (tokens added to the cache
                // this turn). What the user wants in the meta row is
                // the total prompt volume the model actually saw, so
                // we sum every side that arrived as a number. Reading
                // only `usage.input` undercounts massively on second+
                // turns where most of the prompt hits the cache and
                // `usage.input` collapses to a handful of tokens.
                //
                // `inputTokens` / `outputTokens` are legacy flat
                // aliases (kept as a fallback for non-pi-ai providers
                // that don't split the cache columns). We deliberately
                // do NOT coerce a missing side to `0` — doing so
                // would be indistinguishable from a real zero-token
                // step in the meta row, and the query-layer
                // `count(...)` aggregate would mark the side as
                // present when it really isn't.
                const sumPresentNumbers = (
                  parts: Array<unknown>
                ): number | undefined => {
                  let total = 0
                  let saw = false
                  for (const part of parts) {
                    if (typeof part === `number`) {
                      total += part
                      saw = true
                    }
                  }
                  return saw ? total : undefined
                }
                const usageInput =
                  sumPresentNumbers([
                    usage?.input,
                    usage?.cacheRead,
                    usage?.cacheWrite,
                  ]) ??
                  (typeof usage?.inputTokens === `number`
                    ? usage.inputTokens
                    : undefined)
                const usageOutput =
                  typeof usage?.output === `number`
                    ? usage.output
                    : typeof usage?.outputTokens === `number`
                      ? usage.outputTokens
                      : undefined
                bridge.onStepEnd({
                  finishReason,
                  durationMs: Date.now() - stepStartTime,
                  ...(usageInput !== undefined && { tokenInput: usageInput }),
                  ...(usageOutput !== undefined && {
                    tokenOutput: usageOutput,
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
