import { Type } from '@sinclair/typebox'
import { nanoid } from 'nanoid'
import { serverLog } from '../log'
import type { BuiltinAgentModelConfig } from '../model-catalog'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { HandlerContext } from '@electric-ax/agents-runtime'

export const WORKER_TOOL_NAMES = [
  `bash`,
  `read`,
  `write`,
  `edit`,
  `web_search`,
  `fetch_url`,
  `spawn_worker`,
] as const

export type WorkerToolName = (typeof WORKER_TOOL_NAMES)[number]

export function createSpawnWorkerTool(
  ctx: HandlerContext,
  modelConfig?: BuiltinAgentModelConfig
): AgentTool {
  return {
    name: `spawn_worker`,
    label: `Spawn Worker`,
    description: `Dispatch a subagent (worker) to perform an isolated subtask. Provide a system prompt that briefs the worker like a colleague who just walked into the room (file paths, line numbers, what specifically to do, what form of answer you want back) and pick the subset of tools the worker needs.`,
    parameters: Type.Object({
      systemPrompt: Type.String({
        description: `System prompt for the worker. Be concrete: include file paths, line numbers, and the form of answer you want back.`,
      }),
      tools: Type.Array(
        Type.Union(WORKER_TOOL_NAMES.map((n) => Type.Literal(n))),
        {
          description: `Subset of tool names to enable for the worker. Must include at least one.`,
        }
      ),
      initialMessage: Type.String({
        description: `First user message sent to the worker. This is what kicks off its run — without it the worker will idle. Describe the concrete task to perform.`,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const { systemPrompt, tools, initialMessage } = params as {
        systemPrompt: string
        tools: Array<WorkerToolName>
        initialMessage: string
      }
      if (!Array.isArray(tools) || tools.length === 0) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: provide at least one tool for the worker.`,
            },
          ],
          details: { spawned: false },
        }
      }
      if (typeof initialMessage !== `string` || initialMessage.length === 0) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: initialMessage is required and must be a non-empty string.`,
            },
          ],
          details: { spawned: false },
        }
      }

      const id = nanoid(10)
      const workerModelArgs = modelConfig
        ? {
            provider: modelConfig.provider,
            model: modelConfig.model,
            ...(modelConfig.reasoningEffort && {
              reasoningEffort: modelConfig.reasoningEffort,
            }),
          }
        : {}
      try {
        const handle = await ctx.spawn(
          `worker`,
          id,
          { systemPrompt, tools, ...workerModelArgs },
          {
            initialMessage,
            wake: { on: `runFinished`, includeResponse: true },
          }
        )
        const workerUrl = handle.entityUrl

        return {
          content: [
            {
              type: `text` as const,
              text: `Worker dispatched at ${workerUrl}. End your turn — when you next wake, the wake message will tell you the worker has finished and include its response.`,
            },
          ],
          details: { spawned: true, workerUrl },
        }
      } catch (err) {
        serverLog.warn(
          `[spawn_worker tool] failed to spawn worker ${id}: ${err instanceof Error ? err.message : String(err)}`,
          err instanceof Error ? err : undefined
        )
        return {
          content: [
            {
              type: `text` as const,
              text: `Error spawning worker: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: { spawned: false },
        }
      }
    },
  }
}
