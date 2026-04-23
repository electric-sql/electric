import { z } from 'zod'
import type { AgentTool } from '../types'

export interface ContextToolsContext {
  loadTimelineRange: (args: { from: number; to: number }) => Promise<string>
  loadSourceRange: (args: {
    name: string
    from: number
    to: number
    snapshot: string
  }) => Promise<string>
  loadContextHistory: (args: { id: string; offset: string }) => Promise<string>
}

function textResult(text: string) {
  return {
    content: [{ type: `text` as const, text }],
    details: {},
  }
}

export function createContextTools(ctx: ContextToolsContext): Array<AgentTool> {
  return [
    {
      name: `load_timeline_range`,
      label: `Load Timeline Range`,
      description: `Load the rendered messages for a dropped timeline offset range.`,
      parameters: z.object({
        from: z.number(),
        to: z.number(),
      }) as unknown as AgentTool[`parameters`],
      execute: async (_toolCallId, params) =>
        textResult(
          await ctx.loadTimelineRange(
            params as {
              from: number
              to: number
            }
          )
        ),
    },
    {
      name: `load_source_range`,
      label: `Load Source Range`,
      description: `Load a character range from a truncated source snapshot.`,
      parameters: z.object({
        name: z.string(),
        from: z.number(),
        to: z.number(),
        snapshot: z.string(),
      }) as unknown as AgentTool[`parameters`],
      execute: async (_toolCallId, params) =>
        textResult(
          await ctx.loadSourceRange(
            params as {
              name: string
              from: number
              to: number
              snapshot: string
            }
          )
        ),
    },
    {
      name: `load_context_history`,
      label: `Load Context History`,
      description: `Load a tombstoned context entry by its original offset.`,
      parameters: z.object({
        id: z.string(),
        offset: z.string(),
      }) as unknown as AgentTool[`parameters`],
      execute: async (_toolCallId, params) =>
        textResult(
          await ctx.loadContextHistory(
            params as {
              id: string
              offset: string
            }
          )
        ),
    },
  ]
}
