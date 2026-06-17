import { Type } from '@sinclair/typebox'
import { randomBytes } from 'node:crypto'
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
  `send`,
] as const

export type WorkerToolName = (typeof WORKER_TOOL_NAMES)[number]

const MAX_WORKER_SLUG_LENGTH = 48

function normalizeWorkerSlug(slug: unknown): string {
  if (typeof slug !== `string`) return ``

  return slug
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, `-`)
    .replace(/-+/g, `-`)
    .replace(/^-+|-+$/g, ``)
    .slice(0, MAX_WORKER_SLUG_LENGTH)
    .replace(/^-+|-+$/g, ``)
}

export function createSpawnWorkerTool(
  ctx: HandlerContext,
  modelConfig?: BuiltinAgentModelConfig
): AgentTool {
  return {
    name: `spawn_worker`,
    label: `Spawn Worker`,
    description: `Dispatch a subagent (worker) to perform an isolated subtask. Provide a meaningful slug for the worker path, a brief system prompt to give it its role, then a detailed initialMessage which briefs the worker like a colleague who just walked into the room (file paths, line numbers, what specifically to do, what form of answer you want back), and pick the subset of tools the worker needs. The slug is normalized and a few random bytes are appended to keep the worker path unique.`,
    parameters: Type.Object({
      slug: Type.String({
        description: `Short, meaningful slug for this worker, used as the start of its path. Use lowercase words separated by hyphens, e.g. "audit-auth-flow". A random suffix is added automatically for uniqueness.`,
      }),
      systemPrompt: Type.String({
        description: `System prompt for the worker.`,
      }),
      tools: Type.Array(
        Type.Union(WORKER_TOOL_NAMES.map((n) => Type.Literal(n))),
        {
          description: `Subset of tool names to enable for the worker. Must include at least one.`,
        }
      ),
      initialMessage: Type.String({
        description: `First user message sent to the worker. Be concrete: include file paths, line numbers, and the form of answer you want back. This is what kicks off its run — without it the worker will idle. Describe the concrete task to perform and what form of message you want back.`,
      }),
    }),
    execute: async (_toolCallId, params) => {
      const { slug, systemPrompt, tools, initialMessage } = params as {
        slug: string
        systemPrompt: string
        tools: Array<WorkerToolName>
        initialMessage: string
      }
      const normalizedSlug = normalizeWorkerSlug(slug)
      if (normalizedSlug.length === 0 || !/[a-z0-9]/.test(normalizedSlug)) {
        return {
          content: [
            {
              type: `text` as const,
              text: `Error: slug is required and must contain at least one letter or number.`,
            },
          ],
          details: { spawned: false },
        }
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

      const id = `${normalizedSlug}-${randomBytes(3).toString(`hex`)}`
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
            // Run the worker in the parent's sandbox so they share one
            // filesystem. No-op when the parent has no shareable sandbox.
            sandbox: `inherit`,
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
