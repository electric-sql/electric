---
title: Pipeline
titleTemplate: "... - Electric Agents"
description: >-
  Sequential processing pattern where each stage's output feeds into the next via state transitions.
outline: [2, 3]
---

# Pipeline

Pattern: sequential stages where each stage's output feeds into the next.

**Source:** [`examples/durable-agents-playground/src/coordination/pipeline.ts`](https://github.com/electric-sql/durable-streams/blob/main/examples/durable-agents-playground/src/coordination/pipeline.ts)

## Registration

```ts
export function registerPipeline(registry: EntityRegistry) {
  registry.define(`pipeline`, {
    description: `Pipeline orchestrator that chains sequential worker stages, feeding each stage output into the next`,
    state: {
      children: { primaryKey: `key` },
    },

    async handler(ctx) {
      ctx.useAgent({
        systemPrompt: PIPELINE_SYSTEM_PROMPT,
        model: `claude-sonnet-4-5-20250929`,
        tools: [...ctx.darixTools, createRunStageTool(ctx)],
      })
      await ctx.agent.run()
    },
  })
}
```

## How it works

The pipeline agent exposes a `run_stage` tool. The LLM drives the pipeline one stage at a time:

1. The LLM calls `run_stage` with an instruction and input for the current stage.
2. The tool spawns a worker with the instruction as its system prompt and the input as `initialMessage`, using `wake: 'runFinished'`.
3. The tool returns immediately. The pipeline entity is re-invoked when the worker finishes.
4. On each re-invocation, the wake event contains `finished_child.response` with the stage's output. The LLM then calls `run_stage` again with the next stage's instruction and the previous output as input.
5. This repeats until all stages are complete.

## Stage tool

```ts
function createRunStageTool(ctx: HandlerContext): AgentTool {
  let stageCount = 0

  return {
    name: `run_stage`,
    label: `Run Stage`,
    description: `Spawns a worker for one pipeline stage.`,
    parameters: Type.Object({
      instruction: Type.String({
        description: `The instruction for this stage.`,
      }),
      input: Type.String({ description: `The input for this stage.` }),
    }),
    execute: async (_toolCallId, params) => {
      const { instruction, input } = params as {
        instruction: string
        input: string
      }

      stageCount++
      const parentId = entityIdFromUrl(ctx.entityUrl)
      const id = `${parentId}-stage-${stageCount}`

      const child = await ctx.spawn(
        `worker`,
        id,
        { systemPrompt: instruction },
        { initialMessage: input, wake: `runFinished` }
      )
      ctx.db.actions.children_insert({
        row: { key: id, url: child.entityUrl, stage: stageCount },
      })

      return {
        content: [
          {
            type: `text` as const,
            text: `Stage ${stageCount} spawned. You will be woken when it finishes.`,
          },
        ],
        details: { stage: stageCount },
      }
    },
  }
}
```

## State collections

| Collection | Purpose                                             |
| ---------- | --------------------------------------------------- |
| `children` | Spawned worker references (key, URL, stage number). |
