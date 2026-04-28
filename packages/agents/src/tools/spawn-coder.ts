import { Type } from '@sinclair/typebox'
import { nanoid } from 'nanoid'
import { serverLog } from '../log'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { HandlerContext } from '@electric-ax/agents-runtime'

const CODER_AGENT_NAMES = [`claude`, `codex`] as const
type CoderAgentName = (typeof CODER_AGENT_NAMES)[number]

export function createSpawnCoderTool(ctx: HandlerContext): AgentTool {
  return {
    name: `spawn_coder`,
    label: `Spawn Coder`,
    description: `Spawn a coding-session subagent (a coder) that drives a Claude Code or Codex CLI session in a working directory. Use when the user asks for code changes, file edits, debugging, or any task that benefits from a real coding agent with tool access. The coder is long-lived — its URL stays valid across many turns, so you can keep prompting it via prompt_coder without re-spawning. End your turn after spawning; you'll be woken when the coder finishes its first reply.`,
    parameters: Type.Object({
      prompt: Type.String({
        description: `First user message sent to the coder. This is what kicks off the run — without it the coder will idle. Be concrete: describe the task, mention the files/paths involved, and what form of answer you want back.`,
      }),
      agent: Type.Optional(
        Type.Union(
          CODER_AGENT_NAMES.map((n) => Type.Literal(n)),
          {
            description: `Which coding agent to use. Defaults to "claude". Use "codex" only if the user explicitly asks for it.`,
          }
        )
      ),
      cwd: Type.Optional(
        Type.String({
          description: `Working directory the coder runs in. Defaults to the runtime's cwd (the same directory Horton is running in). Set this when the user wants the coder to operate on a different repo.`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { prompt, agent, cwd } = params as {
        prompt: string
        agent?: CoderAgentName
        cwd?: string
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

      const id = nanoid(10)
      const spawnArgs: Record<string, unknown> = {
        agent: agent ?? `claude`,
      }
      if (cwd) spawnArgs.cwd = cwd

      try {
        const handle = await ctx.spawn(`coder`, id, spawnArgs, {
          initialMessage: { text: prompt },
          wake: { on: `runFinished`, includeResponse: true },
        })
        const coderUrl = handle.entityUrl

        return {
          content: [
            {
              type: `text` as const,
              text: `Coder dispatched at ${coderUrl}. End your turn — when the coder finishes its current reply you'll be woken with the response. To send follow-up prompts to the same coder, call prompt_coder with this URL.`,
            },
          ],
          details: { spawned: true, coderUrl },
        }
      } catch (err) {
        serverLog.warn(
          `[spawn_coder tool] failed to spawn coder ${id}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error spawning coder: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { spawned: false },
        }
      }
    },
  }
}

export function createPromptCoderTool(ctx: HandlerContext): AgentTool {
  return {
    name: `prompt_coder`,
    label: `Prompt Coder`,
    description: `Send a follow-up prompt to a coder you previously spawned. The prompt is queued on the coder's inbox and runs as the next CLI turn. End your turn after calling — you'll be woken when the coder's reply lands.`,
    parameters: Type.Object({
      coder_url: Type.String({
        description: `Entity URL returned by spawn_coder, e.g. "/coder/abc123". Must be the URL of a coder you previously spawned in this conversation.`,
      }),
      prompt: Type.String({
        description: `Follow-up message to send to the coder. Treat this like the next turn in a chat — reference earlier context the coder already saw rather than restating it.`,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const { coder_url, prompt } = params as {
        coder_url: string
        prompt: string
      }
      if (typeof coder_url !== `string` || !coder_url.startsWith(`/coder/`)) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: coder_url must be a path like "/coder/<id>".`,
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
        ctx.send(coder_url, { text: prompt })
        return {
          content: [
            {
              type: `text` as const,
              text: `Prompt queued for ${coder_url}. End your turn — you'll be woken when the coder's reply lands.`,
            },
          ],
          details: { sent: true, coderUrl: coder_url },
        }
      } catch (err) {
        serverLog.warn(
          `[prompt_coder tool] failed to send to ${coder_url}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error sending prompt to coder: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { sent: false },
        }
      }
    },
  }
}
