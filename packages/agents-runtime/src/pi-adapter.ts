/**
 * Pi-agent-core adapter — maps pi-agent-core events to State Protocol writes.
 *
 * Responsibilities:
 * - Context translation (LLMMessage[] → AgentMessage[])
 * - Event subscription with async write queue (pi-agent emits synchronously)
 * - Delegating ID management and event writing to OutboundBridge
 */

import { Agent } from '@mariozechner/pi-agent-core'
import { getModel, streamSimple } from '@mariozechner/pi-ai'
import { createOutboundBridge } from './outbound-bridge'
import { MOONSHOT_PROVIDER, getMoonshotModel } from './moonshot-models'
import { runtimeLog } from './log'
import { approxTokens } from './token-budget'
import type { AgentMessageLike, CompactContextFn } from './compaction-midturn'
import {
  ModelProviderError,
  toModelProviderError,
} from './model-provider-error'
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
  reasoning?: SimpleStreamOptions[`reasoning`]
  thinkingBudgets?: SimpleStreamOptions[`thinkingBudgets`]
  onPayload?: SimpleStreamOptions[`onPayload`]
  // Invoked after each step ends with the token counts reported by the
  // provider. Used by goal-budget enforcement to abort mid-run; see
  // OutboundBridgeHooks for the field semantics.
  onStepEnd?: (stats: {
    input: number
    uncachedInput: number
    output: number
  }) => void
  modelTimeoutMs?: number
  modelMaxRetries?: number
  // Mid-turn compaction hook. Called before each model step with the outgoing
  // messages; may return a compacted message list to send instead. The adapter
  // supplies `currentTokens` (real last-step usage + estimated trailing) and the
  // model's context window so the hook can decide. See createMidTurnCompactor.
  onCompactContext?: CompactContextFn
  // Real cache-inclusive token usage entering this run (the previous turn's
  // last step), used to anchor the first step's token estimate.
  initialContextTokens?: number
}

const DEFAULT_MODEL_TIMEOUT_MS = 30_000
const DEFAULT_MODEL_MAX_RETRIES = 2

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
    let reasoningStarted = false
    let reasoningAccum = ``
    let abortedRun = false

    const model = resolvePiModel({
      model: opts.model,
      ...(opts.provider && { provider: opts.provider }),
    })
    const modelTimeoutMs = opts.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS
    const modelMaxRetries = opts.modelMaxRetries ?? DEFAULT_MODEL_MAX_RETRIES

    const baseStreamFn = opts.streamFn ?? streamSimple
    const streamFn: StreamFn = (streamModel, context, streamOptions) =>
      baseStreamFn(streamModel, context, {
        ...streamOptions,
        ...(opts.reasoning && { reasoning: opts.reasoning }),
        ...(opts.thinkingBudgets && { thinkingBudgets: opts.thinkingBudgets }),
        timeoutMs: modelTimeoutMs,
        maxRetries: modelMaxRetries,
      })

    // Mid-turn compaction token accounting (Codex-style): anchor on the real
    // cache-inclusive usage reported for the last model step, plus an estimate
    // of only the items appended since (the trailing tail). `anchorMessageCount`
    // marks the message-array length at that last step so the trailing slice can
    // be measured. Initialised from the previous turn's usage for the first call.
    const estimateContent = (m: AgentMessageLike): number =>
      approxTokens((m as { content?: unknown }).content)
    let anchorTokens =
      opts.initialContextTokens ??
      (history as Array<AgentMessageLike>).reduce(
        (sum, m) => sum + estimateContent(m),
        0
      )
    let anchorMessageCount = history.length
    let pendingRequestMessageCount = anchorMessageCount

    const modelContextWindow =
      typeof model.contextWindow === `number` ? model.contextWindow : 0

    // Stable request parts (constant for the call), estimated once and persisted
    // per step; the UI derives "messages" as the real total minus these.
    const tokenBreakdown = {
      system: approxTokens(opts.systemPrompt),
      tools: approxTokens(JSON.stringify(opts.tools)),
    }

    const transformContext =
      opts.onCompactContext && modelContextWindow > 0
        ? async (
            messages: Array<AgentMessage>
          ): Promise<Array<AgentMessage>> => {
            const list = messages as unknown as Array<AgentMessageLike>
            const trailingTokens = list
              .slice(anchorMessageCount)
              .reduce((sum, m) => sum + estimateContent(m), 0)
            const currentTokens = anchorTokens + trailingTokens
            // Anchor the NEXT step's trailing estimate on this step's *incoming*
            // (uncompacted) message count — NOT the compacted list we may return.
            // pi-agent hands transformContext the full conversation every step,
            // so `list.slice(anchorMessageCount)` next step measures exactly the
            // messages appended since. `anchorTokens` is separately re-anchored
            // to the step's real cache-inclusive usage at message_end.
            pendingRequestMessageCount = messages.length
            const compacted = await opts.onCompactContext!({
              messages: list,
              currentTokens,
              contextWindow: modelContextWindow,
            })
            return compacted
              ? (compacted as unknown as Array<AgentMessage>)
              : messages
          }
        : undefined

    const agentOptions = {
      initialState: {
        systemPrompt: opts.systemPrompt,
        tools: opts.tools as Array<never>,
        messages: history as Array<never>,
        model,
      },
      streamFn,
      ...(transformContext && { transformContext }),
      ...(opts.getApiKey && { getApiKey: opts.getApiKey }),
      ...(opts.onPayload && { onPayload: opts.onPayload }),
    }

    const agent = new Agent(
      agentOptions as ConstructorParameters<typeof Agent>[0]
    )

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
                // pi-ai's `Usage` splits the input side across three
                // counters: `input` (new uncached tokens this turn),
                // `cacheRead` (prompt-cache hits — typically the
                // system prompt + prior history once the cache is
                // warm) and `cacheWrite` (tokens added to the cache
                // this turn). The meta row shows the *uncached* input
                // — `input + cacheWrite` — i.e. the new prompt work
                // this step did. `cacheRead` is deliberately excluded:
                // it re-counts the entire conversation on every warm
                // turn, so including it balloons the label into a
                // cumulative number that says nothing about this
                // response. `cacheWrite` IS counted: cache-enabled
                // providers report newly appended prompt tokens there
                // (with `input` collapsing to ~0), so excluding it
                // would surface tiny "3 input" labels instead.
                //
                // `inputTokens` / `outputTokens` are legacy flat
                // aliases (kept as a fallback for non-pi-ai providers
                // that don't split the cache columns); with no cache
                // split, the whole side counts as uncached. We
                // deliberately do NOT coerce a missing side to `0` —
                // doing so would be indistinguishable from a real
                // zero-token step in the meta row, and the query-layer
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
                  sumPresentNumbers([usage?.input, usage?.cacheWrite]) ??
                  (typeof usage?.inputTokens === `number`
                    ? usage.inputTokens
                    : undefined)
                // Non-cache-hit input — what goal-budget enforcement
                // accumulates. On warm turns `cacheRead` re-counts the whole
                // conversation every step, so budgeting on the display sum
                // would burn a budget in a couple of steps regardless of how
                // much *new* work happened. `cacheWrite` IS counted: on
                // cache-enabled providers the newly appended prompt tokens
                // are reported there (with `usage.input` collapsing to ~0),
                // so excluding it would make the budget track output only.
                // Legacy flat `inputTokens` has no cache split, so the whole
                // side counts as uncached.
                const usageInputUncached =
                  sumPresentNumbers([usage?.input, usage?.cacheWrite]) ??
                  (typeof usage?.inputTokens === `number`
                    ? usage.inputTokens
                    : undefined)
                const usageOutput =
                  typeof usage?.output === `number`
                    ? usage.output
                    : typeof usage?.outputTokens === `number`
                      ? usage.outputTokens
                      : undefined
                // Cache-INCLUSIVE prompt size: every token the request put in
                // the context window, including prompt-cache reads. This is
                // what a "% of context used" gauge needs — cached tokens still
                // occupy the window even though `usageInput` excludes them for
                // budget accounting.
                const usageContext =
                  sumPresentNumbers([
                    usage?.input,
                    usage?.cacheWrite,
                    usage?.cacheRead,
                  ]) ??
                  (typeof usage?.inputTokens === `number`
                    ? usage.inputTokens
                    : undefined)
                const contextWindow =
                  typeof model.contextWindow === `number`
                    ? model.contextWindow
                    : undefined
                // Re-anchor the mid-turn token estimate on this step's real
                // (cache-inclusive) usage and the message count we sent.
                if (usageContext !== undefined) {
                  anchorTokens = usageContext
                  anchorMessageCount = pendingRequestMessageCount
                }
                bridge.onStepEnd({
                  finishReason,
                  durationMs: Date.now() - stepStartTime,
                  ...(usageInput !== undefined && { tokenInput: usageInput }),
                  ...(usageInputUncached !== undefined && {
                    tokenInputUncached: usageInputUncached,
                  }),
                  ...(usageOutput !== undefined && {
                    tokenOutput: usageOutput,
                  }),
                  ...(usageContext !== undefined && {
                    tokenContext: usageContext,
                  }),
                  ...(contextWindow !== undefined && { contextWindow }),
                  tokenBreakdown,
                })

                if (isError) {
                  throw toModelProviderError(
                    new Error(
                      `pi-agent message_end error: ${msg.errorMessage ?? `unknown error`} (stopReason=${msg.stopReason ?? `none`})`
                    ),
                    { provider: model.provider, model: model.id }
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
                const messages = (event as Record<string, unknown>).messages as
                  | Array<{ stopReason?: string; errorMessage?: string }>
                  | undefined
                const errorMessage = messages?.find(
                  (message) =>
                    message.stopReason === `error` && !!message.errorMessage
                )?.errorMessage
                if (errorMessage) {
                  throw toModelProviderError(
                    new Error(`pi-agent agent_end error: ${errorMessage}`),
                    { provider: model.provider, model: model.id }
                  )
                }

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
          const failWithProviderError = (err: unknown): ModelProviderError => {
            const providerError = toModelProviderError(err, {
              provider: model.provider,
              model: model.id,
            })
            bridge.onError({
              errorCode: providerError.code,
              message: providerError.message,
            })
            return providerError
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
              const providerError = failWithProviderError(err)
              finish(`error`)
              reject(providerError)
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
            const providerError = failWithProviderError(err)
            finish(`error`)
            reject(providerError)
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
