import { Type } from '@sinclair/typebox'
import { nanoid } from 'nanoid'
import { serverLog } from '../log'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { HandlerContext } from '@electric-ax/agents-runtime'

export function createSpawnCodingAgentTool(ctx: HandlerContext): AgentTool {
  return {
    name: `spawn_coding_agent`,
    label: `Spawn Coding Agent`,
    description: `Spawn a coding-agent subagent that drives a coding CLI (Claude Code or Codex) inside a Docker sandbox with its own persistent workspace. Use when the user asks for code changes, file edits, debugging, or any task that benefits from a real coding agent with full tool access. Pick the kind: 'claude' (default) for Claude Code or 'codex' for Codex. The coding-agent is long-lived — its URL stays valid across many turns, so keep prompting it via prompt_coding_agent without re-spawning. End your turn after spawning; you'll be woken when the coding-agent finishes its first reply.`,
    parameters: Type.Object({
      prompt: Type.String({
        description: `First user message sent to the coding agent. This kicks off the run — be concrete: describe the task, mention the files/paths involved, and what form of answer you want back.`,
      }),
      kind: Type.Optional(
        Type.Union([Type.Literal(`claude`), Type.Literal(`codex`)], {
          description: `Which coding CLI to drive. 'claude' (default) runs Claude Code; 'codex' runs Codex. Both run inside the Docker sandbox with the same workspace lifecycle.`,
        })
      ),
      workspace_name: Type.Optional(
        Type.String({
          description: `Optional stable name for the Docker volume workspace. If omitted, a name is derived from the agent id. Reuse the same name across sessions to persist state.`,
        })
      ),
      idle_timeout_ms: Type.Optional(
        Type.Number({
          description: `Milliseconds of inactivity after which the sandbox is hibernated. Defaults to 300000 (5 min). The workspace persists; the next prompt cold-boots the container.`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { prompt, kind, workspace_name, idle_timeout_ms } = params as {
        prompt: string
        kind?: `claude` | `codex`
        workspace_name?: string
        idle_timeout_ms?: number
      }
      if (typeof prompt !== `string` || prompt.length === 0) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: prompt is required and must be a non-empty string.`,
            },
          ],
          details: { spawned: false },
        }
      }
      if (kind != null && kind !== `claude` && kind !== `codex`) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: kind must be 'claude' or 'codex' when provided.`,
            },
          ],
          details: { spawned: false },
        }
      }

      const id = nanoid(10)
      const spawnArgs: Record<string, unknown> = {
        kind: kind ?? `claude`,
        workspaceType: `volume`,
      }
      if (workspace_name) spawnArgs.workspaceName = workspace_name
      if (idle_timeout_ms != null) spawnArgs.idleTimeoutMs = idle_timeout_ms

      try {
        const handle = await ctx.spawn(`coding-agent`, id, spawnArgs, {
          initialMessage: { text: prompt },
          wake: { on: `runFinished`, includeResponse: true },
        })
        const agentUrl = handle.entityUrl

        return {
          content: [
            {
              type: `text` as const,
              text: `Coding agent dispatched at ${agentUrl}. End your turn — when the coding agent finishes its current reply you'll be woken with the response. To send follow-up prompts to the same agent, call prompt_coding_agent with this URL.`,
            },
          ],
          details: { spawned: true, agentUrl },
        }
      } catch (err) {
        serverLog.warn(
          `[spawn_coding_agent tool] failed to spawn coding-agent ${id}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error spawning coding agent: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { spawned: false },
        }
      }
    },
  }
}
