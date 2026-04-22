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
import { runtimeLog } from './log'
import type { OutboundIdSeed } from './outbound-bridge'
import type { ChangeEvent } from '@durable-streams/state'
import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  StreamFn,
} from '@mariozechner/pi-agent-core'
import type { LLMMessage } from './types'

// ============================================================================
// Options
// ============================================================================

export interface PiAdapterOptions {
  systemPrompt: string
  model: string
  tools: Array<AgentTool>
  streamFn?: StreamFn
}

interface PiAgentAdapterConfig {
  entityUrl: string
  epoch: number
  messages: Array<LLMMessage>
  outboundIdSeed: OutboundIdSeed
  writeEvent: (event: ChangeEvent) => void
}

interface PiAgentHandle {
  run: (input?: string) => Promise<void>
  steer: (message: string) => void
  isRunning: () => boolean
  dispose: () => void
}

type PiAgentAdapterFactory = (config: PiAgentAdapterConfig) => PiAgentHandle

// ============================================================================
// Context Translation
// ============================================================================

export function toAgentHistory(
  messages: Array<LLMMessage>
): Array<AgentMessage> {
  const history: Array<AgentMessage> = []
  const toolNamesById = new Map<string, string>()

  for (const message of messages) {
    switch (message.role) {
      case `user`:
        history.push({
          role: `user`,
          content: [{ type: `text`, text: message.content }],
          timestamp: Date.now(),
        } as AgentMessage)
        break

      case `assistant`:
        history.push({
          role: `assistant`,
          content: [{ type: `text`, text: message.content }],
          timestamp: Date.now(),
        } as AgentMessage)
        break

      case `tool_call`:
        toolNamesById.set(message.toolCallId, message.toolName)
        history.push({
          role: `assistant`,
          content: [
            {
              type: `toolCall`,
              id: message.toolCallId,
              name: message.toolName,
              arguments:
                (message.toolArgs as Record<string, unknown> | undefined) ?? {},
            },
          ],
          timestamp: Date.now(),
        } as AgentMessage)
        break

      case `tool_result`:
        history.push({
          role: `toolResult`,
          toolCallId: message.toolCallId,
          toolName: toolNamesById.get(message.toolCallId) ?? ``,
          content: [{ type: `text`, text: message.content }],
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

    const model = getModel(
      `anthropic`,
      opts.model as Parameters<typeof getModel>[1]
    )

    const agent = new Agent({
      initialState: {
        systemPrompt: opts.systemPrompt,
        model,
        tools: opts.tools as Array<never>,
        messages: history as Array<never>,
      },
      ...(opts.streamFn && { streamFn: opts.streamFn }),
    })

    function processAgentEvents(
      resolveWhenDone: () => void,
      rejectOnError: (err: Error) => void
    ): () => void {
      const eventQueue: Array<AgentEvent> = []
      let processing = false
      let done = false
      const eventCounts: Record<string, number> = {}
      let textDeltaCount = 0
      const logPrefix = `[${config.entityUrl}]`

      const processQueue = (): void => {
        if (processing || eventQueue.length === 0) return
        processing = true

        while (eventQueue.length > 0) {
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
                  modelProvider: `anthropic`,
                  modelId: opts.model,
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
                  runtimeLog.info(
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
                  msg?.stopReason === `error` || !!msg?.errorMessage

                if (isError) {
                  runtimeLog.error(
                    logPrefix,
                    `pi-adapter message_end ERROR stopReason=${msg.stopReason ?? `none`} ` +
                      `errorMessage=${msg.errorMessage ?? `none`}`
                  )
                } else {
                  runtimeLog.info(
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
                bridge.onToolCallStart(event.toolName, event.args)
                break
              }

              case `tool_execution_end`: {
                bridge.onToolCallEnd(
                  event.toolName,
                  event.result,
                  event.isError
                )
                break
              }

              case `agent_end`: {
                bridge.onRunEnd({ finishReason: `stop` })
                runtimeLog.info(
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
        if (done) {
          running = false
          resolveWhenDone()
        }
      }

      const unsubscribe = agent.subscribe((event: AgentEvent) => {
        eventQueue.push(event)
        processQueue()
      })

      return unsubscribe
    }

    return {
      async run(input?: string): Promise<void> {
        running = true

        bridge.onRunStart()

        return new Promise<void>((resolve, reject) => {
          const unsubscribe = processAgentEvents(
            () => {
              unsubscribe()
              resolve()
            },
            (err) => {
              unsubscribe()
              reject(err)
            }
          )

          const runPromise =
            input !== undefined ? agent.prompt(input) : agent.continue()

          Promise.resolve(runPromise).catch((err: Error) => {
            running = false
            bridge.onRunEnd({ finishReason: `error` })
            unsubscribe()
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

      dispose(): void {
        disposed = true
        running = false
      },
    }
  }
}
