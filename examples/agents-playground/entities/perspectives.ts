import type {
  EntityRegistry,
  HandlerContext,
} from '@electric-ax/agents-runtime'
import { Type } from '@sinclair/typebox'

const PERSPECTIVES = [
  {
    id: `optimist`,
    systemPrompt: `You are an optimist analyst. Provide an enthusiastic, positive analysis focusing on opportunities, benefits, and reasons for hope. Be genuine and evidence-based, not naive. Answer directly — do not comment on tools or capabilities.`,
  },
  {
    id: `critic`,
    systemPrompt: `You are a critical analyst. Provide a sharp analysis focusing on risks, downsides, and challenges. Be constructive and evidence-based, not cynical. Answer directly — do not comment on tools or capabilities.`,
  },
]

function createAnalyzeTool(ctx: HandlerContext) {
  return {
    name: `analyze_question`,
    label: `Analyze Question`,
    description: `Spawns optimist and critic workers to analyze a question from multiple perspectives.`,
    parameters: Type.Object({
      question: Type.String({ description: `The question to analyze` }),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const { question } = params as { question: string }
      const parentId = ctx.entityUrl.split(`/`).pop()

      for (const p of PERSPECTIVES) {
        const childId = `${parentId}-${p.id}`
        await ctx.spawn(
          `worker`,
          childId,
          { systemPrompt: p.systemPrompt, tools: [`bash`] },
          { initialMessage: question, wake: `runFinished` }
        )
        ctx.db.actions.children_insert({
          row: { key: p.id, url: `/worker/${childId}` },
        })
      }

      return {
        content: [
          {
            type: `text` as const,
            text: `Spawned optimist and critic workers. You'll be woken as each finishes.`,
          },
        ],
        details: {},
      }
    },
  }
}

export function registerPerspectives(registry: EntityRegistry) {
  registry.define(`perspectives`, {
    description: `Analyzes questions from two perspectives: optimist and critic`,
    state: { children: { primaryKey: `key` } },
    async handler(ctx) {
      ctx.useAgent({
        systemPrompt: `You are a balanced analyst.\n\n1. Call analyze_question with the question.\n2. End your turn. You'll be woken as each worker finishes.\n3. Each wake includes finished_child.response and other_children.\n4. Once both are done, synthesize a balanced response.`,
        model: `claude-sonnet-4-6`,
        tools: [...ctx.electricTools, createAnalyzeTool(ctx)],
      })
      await ctx.agent.run()
    },
  })
}
