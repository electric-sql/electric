import { Type } from '@sinclair/typebox'
import type { AgentTool, SendResult } from '../types'

type SendFn = (
  entityUrl: string,
  payload: unknown,
  opts?: { type?: string; afterMs?: number }
) => Promise<SendResult>

function asToolResult(value: unknown) {
  return {
    content: [
      {
        type: `text` as const,
        text:
          typeof value === `string` ? value : JSON.stringify(value, null, 2),
      },
    ],
    details: {},
  }
}

export function createSendTool(send: SendFn): AgentTool {
  return {
    name: `send`,
    label: `Send Message`,
    description: `Send a message to an Electric Agent/entity by entity URL. Use afterMs to schedule delayed delivery.`,
    parameters: Type.Object({
      entityUrl: Type.String({
        description: `Target entity URL to send the message to.`,
      }),
      payload: Type.Any({
        description: `Message payload to deliver to the target entity.`,
      }),
      type: Type.Optional(
        Type.String({ description: `Optional message type.` })
      ),
      afterMs: Type.Optional(
        Type.Number({
          description: `Optional delay in milliseconds before delivery.`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { entityUrl, payload, type, afterMs } = params as {
        entityUrl: string
        payload: unknown
        type?: string
        afterMs?: number
      }

      if (afterMs !== undefined && (!Number.isFinite(afterMs) || afterMs < 0)) {
        throw new Error(`afterMs must be a non-negative finite number`)
      }

      try {
        const result = await send(entityUrl, payload, { type, afterMs })
        return asToolResult({ sent: true, entityUrl, type, afterMs, result })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return asToolResult({
          sent: false,
          error: true,
          entityUrl,
          type,
          afterMs,
          message: `Failed to send to ${entityUrl}: ${message}`,
        })
      }
    },
  }
}
