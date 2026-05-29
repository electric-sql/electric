import { Type } from '@sinclair/typebox'
import type { AgentTool, SendResult } from '../types'

type SendFn = (
  entityUrl: string,
  payload: unknown,
  opts?: { type?: string; afterMs?: number }
) => Promise<SendResult>

export interface CreateSendToolOptions {
  /** Optional URL of the current entity, used when the tool is called with `self: true`. */
  selfEntityUrl?: string
}

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

export function createSendTool(
  send: SendFn,
  opts: CreateSendToolOptions = {}
): AgentTool {
  return {
    name: `send`,
    label: `Send Message`,
    description: `Send a message to an Electric Agent/entity. Set self: true to send to yourself; use this with afterMs to schedule future work for yourself. Otherwise provide entityUrl.`,
    parameters: Type.Object({
      entityUrl: Type.Optional(
        Type.String({
          description: `Target entity URL to send the message to. Omit when self is true.`,
        })
      ),
      self: Type.Optional(
        Type.Boolean({
          description: `Send to this agent/entity. Use self: true with afterMs when scheduling future work for yourself.`,
        })
      ),
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
      const { entityUrl, self, payload, type, afterMs } = params as {
        entityUrl?: string
        self?: boolean
        payload: unknown
        type?: string
        afterMs?: number
      }

      try {
        if (
          afterMs !== undefined &&
          (!Number.isFinite(afterMs) || afterMs < 0)
        ) {
          throw new Error(`afterMs must be a non-negative finite number`)
        }

        if (self && !opts.selfEntityUrl) {
          throw new Error(`self is not available in this context`)
        }
        if (!self && !entityUrl) {
          throw new Error(`provide entityUrl or set self: true`)
        }

        const targetUrl = self ? opts.selfEntityUrl! : entityUrl!
        const result = await send(targetUrl, payload, { type, afterMs })
        return asToolResult({
          sent: true,
          entityUrl,
          self,
          targetUrl,
          type,
          afterMs,
          result,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return asToolResult({
          sent: false,
          error: true,
          entityUrl,
          self,
          type,
          afterMs,
          message: `Failed to send to ${self ? `self` : (entityUrl ?? `target`)}: ${message}`,
        })
      }
    },
  }
}
