import { db } from '@electric-ax/agents-runtime'
import { z } from 'zod'
import { swarmSharedSchema } from './schema.js'
import {
  createFetchUrlTool,
  createSharedWikiTools,
  createWebSearchTool,
  type SwarmSharedState,
} from './shared-tools.js'
import { surveyWorkerModelConfig } from './model-config.js'
import type { EntityRegistry } from '@electric-ax/agents-runtime'

export const SURVEY_WORKER_ENTITY_TYPE = `survey_worker`

const surveyWorkerArgsSchema = z.object({
  systemPrompt: z.string().min(1),
  sharedStateId: z.string().min(1),
})

export function registerSurveyWorker(registry: EntityRegistry): void {
  registry.define(SURVEY_WORKER_ENTITY_TYPE, {
    description: `Deep survey explorer worker — researches one topic and writes wiki entries plus cross-references`,
    creationSchema: surveyWorkerArgsSchema,

    async handler(ctx) {
      const args = surveyWorkerArgsSchema.parse(ctx.args)
      const shared = (await ctx.observe(
        db(args.sharedStateId, swarmSharedSchema)
      )) as unknown as SwarmSharedState

      ctx.useAgent({
        systemPrompt: args.systemPrompt,
        ...surveyWorkerModelConfig(),
        tools: [
          createWebSearchTool(),
          createFetchUrlTool(),
          ...createSharedWikiTools(shared),
        ],
      })
      await ctx.agent.run()
    },
  })
}
