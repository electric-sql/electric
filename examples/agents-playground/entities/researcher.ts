import type {
  EntityRegistry,
  HandlerContext,
} from '@electric-ax/agents-runtime'
import { Type } from '@sinclair/typebox'

const RESEARCHER_SYSTEM_PROMPT = `You are a deep research analyst.

Start by deciding whether the request is clear enough to decompose:
- If the goal, audience, timeframe, or deliverable is unclear, ask up to 3 precise clarifying questions before spawning any specialists.
- If the request is already clear and narrow, research it yourself and answer directly with citations.

For complex topics that are clear enough to decompose:
- First do a quick terrain-mapping pass yourself so you understand the major sub-questions and likely specialist tracks.
- Then use research_with_specialists to create one or more specialist sub-agents focused on distinct sub-questions.
- After the tool returns, end your turn with a brief status message. Do NOT call any other tools. You will be automatically re-invoked as each specialist finishes.
- Each time you are re-invoked, a WAKE EVENT includes \`finished_child.response\` with that specialist's findings and \`other_children\` with sibling status.
- Each specialist worker has access to bash tools. Give them precise instructions about the slice they own and what evidence to gather.
- Once all specialists have reported in, synthesize all findings into a clear, organized response with citations.

Always cite sources with their full URLs. Structure your final response clearly with sections when covering multiple angles.`

const specialistSpecSchema = Type.Object({
  id: Type.String({
    description: `A stable identifier for this sub-agent (e.g. "climate-mitigation", "economic-impact"). Reuse the same id when you want to rerun the same specialty.`,
  }),
  systemPrompt: Type.String({
    description: `A focused prompt for the specialist that includes both their role and the specific research task. Include instructions to cite all sources with full URLs.`,
  }),
})

function createResearchWorkerPrompt(systemPrompt: string): string {
  return [
    `You are a specialist research worker contributing one part of a larger investigation.`,
    `Use your bash tools to gather evidence before you answer.`,
    `Always cite full URLs for every substantive claim you make.`,
    `Answer directly — do not comment on tools or capabilities.`,
    systemPrompt,
  ].join(`\n\n`)
}

function createResearchWithSpecialistsTool(ctx: HandlerContext) {
  return {
    name: `research_with_specialists`,
    label: `Research With Specialists`,
    description: `After you have scoped the problem, spawn one or more specialist sub-agents to research distinct sub-questions in parallel.`,
    parameters: Type.Object({
      specialists: Type.Array(specialistSpecSchema, {
        description: `The specialist sub-agents to run. Each specialist gets its own stable id and focused research prompt.`,
        minItems: 1,
      }),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const { specialists } = params as {
        specialists: Array<{
          id: string
          systemPrompt: string
        }>
      }

      const parentId = ctx.entityUrl.split(`/`).pop()
      let spawned = 0

      for (const specialist of specialists) {
        const childId = `${parentId}-${specialist.id}`
        const workerSystemPrompt = createResearchWorkerPrompt(
          specialist.systemPrompt
        )

        await ctx.spawn(
          `worker`,
          childId,
          { systemPrompt: workerSystemPrompt, tools: [`bash`] },
          { initialMessage: specialist.systemPrompt, wake: `runFinished` }
        )
        ctx.db.actions.children_insert({
          row: {
            key: specialist.id,
            url: `/worker/${childId}`,
          },
        })
        spawned += 1
      }

      return {
        content: [
          {
            type: `text` as const,
            text: `Launched ${spawned} specialist researchers. You will be woken as each finishes with their findings in finished_child.response.`,
          },
        ],
        details: {
          specialists: specialists.map((s) => s.id),
          spawned,
        },
      }
    },
  }
}

export function registerResearcher(registry: EntityRegistry) {
  registry.define(`researcher`, {
    description: `Research analyst that spawns deep-dive specialist sub-agents for complex topics`,
    state: { children: { primaryKey: `key` } },

    async handler(ctx) {
      ctx.useAgent({
        systemPrompt: RESEARCHER_SYSTEM_PROMPT,
        model: `claude-sonnet-4-6`,
        tools: [...ctx.electricTools, createResearchWithSpecialistsTool(ctx)],
      })
      await ctx.agent.run()
    },
  })
}
