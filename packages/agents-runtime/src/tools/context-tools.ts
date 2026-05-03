import { Type } from '@sinclair/typebox'
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
      parameters: Type.Object({
        from: Type.Number(),
        to: Type.Number(),
      }) as AgentTool[`parameters`],
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
      parameters: Type.Object({
        name: Type.String(),
        from: Type.Number(),
        to: Type.Number(),
        snapshot: Type.String(),
      }) as AgentTool[`parameters`],
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
      parameters: Type.Object({
        id: Type.String(),
        offset: Type.String(),
      }) as AgentTool[`parameters`],
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
