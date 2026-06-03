import { Type } from '@sinclair/typebox'
import { serverLog } from '../log'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { HandlerContext } from '@electric-ax/agents-runtime'

export function createForkTool(ctx: HandlerContext): AgentTool {
  return {
    name: `fork`,
    label: `Fork`,
    description: `Fork a session at its latest completed agent response, producing a sibling copy of the conversation up to that point. The new session boots idle — use the existing 'send' tool to dispatch a follow-up prompt to it. The fork is auto-observed: when its next run finishes you will be woken with the response, so end your turn after forking.

Use this to explore multiple alternative continuations in parallel from the same starting point. End your current turn first so the fork includes your latest response — the anchor is always the most recently completed run.

Omit 'entityUrl' to fork your own session. Pass a different session's URL to fork that session instead.`,
    parameters: Type.Object({
      entityUrl: Type.Optional(
        Type.String({
          description: `URL of the session to fork. Omit to fork your own session.`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { entityUrl } = params as { entityUrl?: string }
      try {
        const { url } = await ctx.fork(entityUrl)
        return {
          content: [
            {
              type: `text` as const,
              text: `Forked at ${url}. The fork boots idle — use the 'send' tool to dispatch a follow-up prompt. End your turn afterwards; you'll wake when the fork's next run finishes.`,
            },
          ],
          details: { forked: true, forkUrl: url },
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : `Unknown error`
        serverLog.warn(
          `[fork tool] failed to fork ${entityUrl ?? `<self>`}: ${message}`,
          err instanceof Error ? err : undefined
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error forking session: ${message}`,
            },
          ],
          details: { forked: false },
        }
      }
    },
  }
}
