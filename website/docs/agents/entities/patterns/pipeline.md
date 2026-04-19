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
      status: { primaryKey: `key` },
      children: { primaryKey: `key` },
      pipeline: { primaryKey: `key` },
    },

    async handler(ctx) {
      if (ctx.firstWake) {
        ctx.state.status.insert({ key: `current`, value: `idle` })
        ctx.state.pipeline.insert({
          key: `state`,
          currentInput: ``,
          currentStage: 0,
        })
      }

      ctx.configureAgent({
        systemPrompt: PIPELINE_SYSTEM_PROMPT,
        model: `claude-sonnet-4-5-20250929`,
        tools: [...ctx.darixTools, createRunPipelineTool(ctx)],
      })
      await ctx.agent.run()
    },
  })
}
```

## How it works

The pipeline agent exposes a `run_pipeline` tool. When the LLM calls it with an array of stage instructions and initial input, the tool:

1. Loops through stages sequentially.
2. Spawns a worker per stage with the stage instruction as its system prompt.
3. Sends the current input as `initialMessage` with `wake: 'runFinished'`.
4. Awaits the worker's output and feeds it as input to the next stage.
5. Uses state transition guards to track progress through stages.

## Core loop

```ts
for (let index = 0; index < stages.length; index++) {
  const stageNumber = index + 1
  const stageLabel = stages[index]?.trim() || `stage-${stageNumber}`

  transition(
    ctx.state.status,
    PIPELINE_TRANSITIONS,
    currentPipelineStatus(stageNumber)
  )

  const childId = `${parentId}-stage-${stageNumber}`
  const child = await ctx.spawn(
    `worker`,
    childId,
    { systemPrompt: stageLabel },
    { initialMessage: currentInput, wake: `runFinished` }
  )

  ctx.state.children.insert({
    key: childId,
    url: child.entityUrl,
    stage: stageNumber,
  })

  currentInput = await readLatestCompletedText(child, stageLabel)
}
```

## State transitions

```ts
type PipelineStatus =
  | "idle"
  | "stage_1"
  | "stage_2"
  | "stage_3"
  | "stage_4"
  | "stage_5"
  | "done"

const PIPELINE_TRANSITIONS: Record<PipelineStatus, readonly PipelineStatus[]> =
  {
    idle: ["stage_1"],
    stage_1: ["stage_2", "done"],
    stage_2: ["stage_3", "done"],
    stage_3: ["stage_4", "done"],
    stage_4: ["stage_5", "done"],
    stage_5: ["done"],
    done: ["idle"],
  }
```

The `transition()` guard enforces valid state changes. Each stage can transition to the next stage or directly to `done` (for short pipelines).

## State collections

| Collection | Purpose                                             |
| ---------- | --------------------------------------------------- |
| `status`   | Current pipeline status.                            |
| `children` | Spawned worker references (key, URL, stage number). |
| `pipeline` | Current input and stage index for resumability.     |
