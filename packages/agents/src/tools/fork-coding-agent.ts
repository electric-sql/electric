import { Type } from '@sinclair/typebox'
import { nanoid } from 'nanoid'
import { serverLog } from '../log'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { HandlerContext } from '@electric-ax/agents-runtime'

export function createForkCodingAgentTool(ctx: HandlerContext): AgentTool {
  return {
    name: `fork_coding_agent`,
    label: `Fork Coding Agent`,
    description: `Spawn a new coding agent that starts with another agent's denormalized conversation history. The new agent runs the chosen kind (claude or codex) and inherits or clones the source's workspace per workspace_mode. Use to compare CLIs on the same conversation, or branch experimentally.`,
    parameters: Type.Object({
      source_url: Type.String({
        description: `Entity URL of the source coding agent to fork from, e.g. "/coding-agent/abc123".`,
      }),
      kind: Type.Union([Type.Literal(`claude`), Type.Literal(`codex`)], {
        description: `Kind for the new agent: 'claude' or 'codex'.`,
      }),
      workspace_mode: Type.Optional(
        Type.Union(
          [Type.Literal(`share`), Type.Literal(`clone`), Type.Literal(`fresh`)],
          {
            description: `How the new agent's workspace relates to the source's. 'share' (default for bindMount): same workspace, lease-serialised. 'clone' (default for volume): copy contents into a fresh volume. 'fresh': new empty workspace.`,
          }
        )
      ),
      initial_prompt: Type.Optional(
        Type.String({
          description: `Optional first prompt to send to the fork after spawn. If omitted, the fork is idle until prompted.`,
        })
      ),
      model: Type.Optional(
        Type.String({
          description: `Optional model override for the new kind.`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { source_url, kind, workspace_mode, initial_prompt, model } =
        params as {
          source_url: string
          kind: `claude` | `codex`
          workspace_mode?: `share` | `clone` | `fresh`
          initial_prompt?: string
          model?: string
        }
      if (
        typeof source_url !== `string` ||
        !source_url.startsWith(`/coding-agent/`)
      ) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: source_url must be a path like "/coding-agent/<id>".`,
            },
          ],
          details: { spawned: false },
        }
      }
      const id = nanoid(10)
      const spawnArgs: Record<string, unknown> = {
        kind,
        workspaceType: `volume`,
        fromAgentId: source_url,
      }
      if (workspace_mode) spawnArgs.fromWorkspaceMode = workspace_mode
      if (model) spawnArgs.model = model
      try {
        const handle = await ctx.spawn(`coding-agent`, id, spawnArgs, {
          ...(initial_prompt
            ? { initialMessage: { text: initial_prompt } }
            : {}),
          wake: { on: `runFinished`, includeResponse: true },
        })
        return {
          content: [
            {
              type: `text` as const,
              text: `Forked coding agent dispatched at ${handle.entityUrl} (kind=${kind}, source=${source_url}). End your turn — when it replies you'll be woken.`,
            },
          ],
          details: { spawned: true, agentUrl: handle.entityUrl },
        }
      } catch (err) {
        serverLog.warn(
          `[fork_coding_agent tool] failed: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error forking coding agent: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { spawned: false },
        }
      }
    },
  }
}
