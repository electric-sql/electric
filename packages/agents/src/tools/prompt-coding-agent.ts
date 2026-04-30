import { Type } from '@sinclair/typebox'
import { serverLog } from '../log'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { HandlerContext } from '@electric-ax/agents-runtime'

export function createPromptCodingAgentTool(ctx: HandlerContext): AgentTool {
  return {
    name: `prompt_coding_agent`,
    label: `Prompt Coding Agent`,
    description: `Send a follow-up prompt to a coding agent you previously spawned. The prompt is queued on the agent's inbox and runs as the next CLI turn (resuming from prior context). End your turn after calling — you'll be woken when the agent's reply lands.`,
    parameters: Type.Object({
      coding_agent_url: Type.String({
        description: `Entity URL returned by spawn_coding_agent, e.g. "/coding-agent/abc123". Must be the URL of a coding agent you previously spawned in this conversation.`,
      }),
      prompt: Type.String({
        description: `Follow-up message to send to the coding agent. Reference earlier context the agent already saw rather than restating it from scratch.`,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const { coding_agent_url, prompt } = params as {
        coding_agent_url: string
        prompt: string
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
          details: { sent: false },
        }
      }
      if (typeof prompt !== `string` || prompt.length === 0) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: prompt is required and must be a non-empty string.`,
            },
          ],
          details: { sent: false },
        }
      }

      try {
        ctx.send(coding_agent_url, { text: prompt })
        return {
          content: [
            {
              type: `text` as const,
              text: `Prompt queued for ${coding_agent_url}. End your turn — you'll be woken when the coding agent's reply lands.`,
            },
          ],
          details: { sent: true, agentUrl: coding_agent_url },
        }
      } catch (err) {
        serverLog.warn(
          `[prompt_coding_agent tool] failed to send to ${coding_agent_url}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error sending prompt to coding agent: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { sent: false },
        }
      }
    },
  }
}
