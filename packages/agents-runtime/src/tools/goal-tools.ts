import { Type } from '@sinclair/typebox'
import type { AgentTool, HandlerContext } from '../types'

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

// `mark_goal_complete` is the LLM's signal that the active goal has been met.
// The runtime uses this to break out of the continuation loop.
export function createMarkGoalCompleteTool(
  ctx: Pick<HandlerContext, `markGoalComplete` | `getGoal`>
): AgentTool {
  return {
    name: `mark_goal_complete`,
    label: `Mark Goal Complete`,
    description: `Mark the active goal as complete. Call this when you have finished the work described in the goal. After this is called, the runtime will stop driving you toward the goal.`,
    parameters: Type.Object({
      summary: Type.Optional(
        Type.String({
          description: `Optional short summary of what was accomplished. Recorded with the goal but not required.`,
        })
      ),
    }),
    execute: async (_toolCallId, _params) => {
      const before = ctx.getGoal()
      if (!before) {
        return asToolResult({
          completed: false,
          message: `No active goal to mark complete.`,
        })
      }
      const updated = ctx.markGoalComplete()
      return asToolResult({
        completed: true,
        objective: updated?.objective ?? before.objective,
        status: updated?.status ?? `complete`,
      })
    },
  }
}
