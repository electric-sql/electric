import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { HandlerContext } from '@electric-ax/agents-runtime'

export function createSetTitleTool(ctx: HandlerContext): AgentTool {
  return {
    name: `set_title`,
    label: `Set Title`,
    description: `Set the chat session title shown in the UI. Use this when the current title is missing, stale, misleading, or the user asks to rename the session. Provide a concise, human-readable title.`,
    parameters: Type.Object({
      title: Type.String({
        description: `New session title. Whitespace is trimmed and the title must not be empty.`,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const { title } = params as { title?: unknown }
      const trimmedTitle = typeof title === `string` ? title.trim() : ``

      if (trimmedTitle.length === 0) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: title must be a non-empty string.`,
            },
          ],
          details: { updated: false },
        }
      }

      try {
        await ctx.setTag(`title`, trimmedTitle)
        return {
          content: [
            {
              type: `text` as const,
              text: `Session title set to “${trimmedTitle}”.`,
            },
          ],
          details: { updated: true, title: trimmedTitle },
        }
      } catch (err) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error setting session title: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { updated: false },
        }
      }
    },
  }
}
