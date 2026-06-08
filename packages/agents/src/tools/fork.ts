import { Type } from '@sinclair/typebox'
import { nanoid } from 'nanoid'
import { serverLog } from '../log'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { HandlerContext } from '@electric-ax/agents-runtime'

export function createForkTool(ctx: HandlerContext): AgentTool {
  return {
    name: `fork`,
    label: `Fork`,
    description: `Fork a session at its latest completed agent response, producing a child copy of the conversation up to that point. The new fork is YOUR child — same parent-ownership model as a spawned worker — and it reports back to you the same way: when its next run finishes you'll be woken with its response. End your turn after forking.

Prefer supplying an 'initialMessage' so the fork is dispatched immediately in a single call — no follow-up 'send' needed. If you omit it, the fork boots idle and you'll need to call 'send' afterwards. For chat-rendered messages use the shape \`{ "text": "..." }\` so the prompt shows up in the chat UI.

Use this to explore multiple alternative continuations in parallel from the same starting point. End your current turn first so the fork includes your latest response — the anchor is always the most recently completed run.

Omit 'entityUrl' to fork your own session. Pass a different session's URL to fork that session instead (the new fork is still your child). The optional 'id' names the new fork's instance — useful when you want stable, predictable URLs (e.g. labelling branches in a parallel exploration); omit to let the server mint one.`,
    parameters: Type.Object({
      entityUrl: Type.Optional(
        Type.String({
          description: `URL of the session to fork. Omit to fork your own session.`,
        })
      ),
      id: Type.Optional(
        Type.String({
          description: `Instance id for the new fork (the \`<id>\` in \`/horton/<id>\`). Mirrors spawn_worker's id parameter. Omit to let the server assign one.`,
        })
      ),
      initialMessage: Type.Optional(
        Type.Any({
          description: `Initial inbox message delivered to the fork by the server in the same round-trip — the fork wakes and starts running immediately, no follow-up 'send' needed. Use the shape \`{ "text": "..." }\` for chat-rendered prompts. Omit to leave the fork idle (then call 'send' separately).`,
        })
      ),
      tags: Type.Optional(
        Type.Record(Type.String(), Type.String(), {
          description: `Optional tags stamped on the new fork, on top of those copied from the source. Useful for labelling experiments (e.g. \`{ "experiment": "ecosystem-maturity" }\`).`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { entityUrl, id, initialMessage, tags } = params as {
        entityUrl?: string
        id?: string
        initialMessage?: unknown
        tags?: Record<string, string>
      }
      try {
        const opts = {
          ...(initialMessage !== undefined && { initialMessage }),
          ...(tags !== undefined && { tags }),
        }
        // The library API (`ctx.fork` / `ctx.forkSelf`) requires an id
        // — same shape as `ctx.spawn(type, id, ...)`. The model layer
        // doesn't need to know this; we generate one via nanoid when
        // it's not supplied (same pattern `createSpawnWorkerTool` uses
        // for the worker's id).
        const forkId = id ?? `fork-${nanoid(10)}`
        const handle =
          entityUrl !== undefined
            ? await ctx.fork(entityUrl, forkId, opts)
            : await ctx.forkSelf(forkId, opts)
        const dispatchNote =
          initialMessage !== undefined
            ? `The initial message has been delivered to the fork — it will start running.`
            : `The fork boots idle — use the 'send' tool to dispatch a follow-up prompt.`
        return {
          content: [
            {
              type: `text` as const,
              text: `Forked at ${handle.entityUrl}. ${dispatchNote} End your turn; you'll wake with the fork's response when its next run finishes (same as a spawned worker).`,
            },
          ],
          details: { forked: true, forkUrl: handle.entityUrl },
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
