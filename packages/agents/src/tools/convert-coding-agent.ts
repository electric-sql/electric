import { Type } from '@sinclair/typebox'
import { serverLog } from '../log'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { HandlerContext } from '@electric-ax/agents-runtime'

export function createConvertCodingAgentTool(ctx: HandlerContext): AgentTool {
  return {
    name: `convert_coding_agent`,
    label: `Convert Coding Agent Kind`,
    description: `Convert a previously-spawned coding agent's kind in place (claude→codex or codex→claude). The agent's conversation history is preserved (denormalized for the new kind). Useful when one CLI fits a task better, or to compare model outputs on the same context. The agent stays at the same URL; the next prompt will run under the new kind.`,
    parameters: Type.Object({
      coding_agent_url: Type.String({
        description: `Entity URL returned by spawn_coding_agent, e.g. "/coding-agent/abc123".`,
      }),
      kind: Type.Union([Type.Literal(`claude`), Type.Literal(`codex`)], {
        description: `Target kind: 'claude' or 'codex'.`,
      }),
      model: Type.Optional(
        Type.String({
          description: `Optional model override for the new kind (e.g. 'claude-haiku-4-5-20251001' or a codex model id).`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { coding_agent_url, kind, model } = params as {
        coding_agent_url: string
        kind: `claude` | `codex`
        model?: string
      }
      if (
        typeof coding_agent_url !== `string` ||
        !coding_agent_url.startsWith(`/coding-agent/`)
      ) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: coding_agent_url must be a path like "/coding-agent/<id>".`,
            },
          ],
          details: { converted: false },
        }
      }
      try {
        ctx.send(
          coding_agent_url,
          { kind, ...(model ? { model } : {}) },
          { type: `convert-kind` }
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Conversion to ${kind} queued for ${coding_agent_url}. The next prompt will run under the new kind.`,
            },
          ],
          details: { converted: true, agentUrl: coding_agent_url, kind },
        }
      } catch (err) {
        serverLog.warn(
          `[convert_coding_agent tool] failed for ${coding_agent_url}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error converting coding agent: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { converted: false },
        }
      }
    },
  }
}
