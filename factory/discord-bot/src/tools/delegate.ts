import { Type } from '@sinclair/typebox'
import type {
  AgentTool,
  RuntimeServerClient,
} from '@electric-ax/agents-runtime'

export interface SpawnHortonOptions {
  runtime: RuntimeServerClient
  hortonEntityType: string
  threadId: string
  defaultRepo: string
  parentUrl: string
}

export function createSpawnHortonTool(opts: SpawnHortonOptions): AgentTool {
  return {
    name: `spawn_horton`,
    label: `Delegate coding task to Horton`,
    description:
      `Spawn a Horton coding agent in a separate runtime host. ` +
      `Returns immediately with the child entity URL; Horton's final report ` +
      `arrives later as a child_completed wake.`,
    parameters: Type.Object({
      task: Type.String({
        description: `Detailed system prompt / brief for Horton. Include issue details, acceptance criteria, repo context.`,
      }),
      initialMessage: Type.String({
        description: `First user message Horton wakes on — the concrete instruction.`,
      }),
      branch: Type.String({
        description: `Working branch name, e.g. electric-bot/thread-<id>`,
      }),
    }),
    async execute(_id, params) {
      const { task, initialMessage, branch } = params as {
        task: string
        initialMessage: string
        branch: string
      }
      const childId = `horton-${opts.threadId}-${Date.now()}`
      const info = await opts.runtime.spawnEntity({
        type: opts.hortonEntityType,
        id: childId,
        parentUrl: opts.parentUrl,
        initialMessage,
        args: {
          task,
          repo: opts.defaultRepo,
          branch,
        },
        wake: {
          subscriberUrl: opts.parentUrl,
          condition: `runFinished`,
          includeResponse: true,
        },
      })
      return {
        content: [
          {
            type: `text` as const,
            text: `Spawned horton at ${info.entityUrl}`,
          },
        ],
        details: { childEntityUrl: info.entityUrl, childEntityId: childId },
      }
    },
  }
}
