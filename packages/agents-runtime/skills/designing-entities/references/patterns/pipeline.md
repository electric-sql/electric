# Pattern: pipeline

Sequential stages where each stage's output feeds into the next. Stage 1 → Stage 2 → Stage 3 → done. A state machine enforces the order; each stage is a spawned worker with a specific `systemPrompt`.

**Canonical description:** `/docs/entities/patterns/pipeline`

**Canonical example:** `examples/durable-agents-playground/src/coordination/pipeline.ts` — note the playground registers its own `worker`; when a real app spawns `"worker"` it gets the built-in sandboxed worker (see `/docs/entities/agents/worker`), which requires `{ systemPrompt, tools }`.

## When this pattern applies

- Work that must be done in a specific order.
- Each stage depends on the previous stage's output.
- Number of stages is known up front.

If stages can run in parallel → `map-reduce`. If all specialists examine the same input independently → `manager-worker`.

## Required state

```ts
state: {
  children: {
    schema: z.object({
      key: z.string(),    // `${entityId}-stage-${stageNumber}`
      url: z.string(),
      stage: z.number(),
    }),
    primaryKey: "key",
  },
  status: {
    schema: z.object({
      key: z.literal("current"),
      value: z.enum(["idle", "stage_1", "stage_2", "stage_N", "done"]),
    }),
    primaryKey: "key",
  },
}
```

Use a `transition(stateProxy, transitions, nextStatus)` helper (see the canonical example) to enforce valid state-machine moves.

## Handler skeleton

```ts
import { entity } from "@electric-ax/agents-runtime"

const STAGES = [
  "You are the preprocessor. Clean the input...",
  "You are the analyzer. Analyze the cleaned input...",
  "You are the synthesizer. Produce the final report...",
]

async handler(ctx, wake) {
  if (ctx.firstWake) {
    ctx.db.actions.status_insert({ row: { key: "current", value: "idle" } })
  }

  const runPipelineTool: AgentTool = {
    name: "run_pipeline",
    parameters: Type.Object({ input: Type.String() }),
    execute: async (_id, { input }) => {
      let currentInput = input
      const parentId = ctx.entityUrl.split("/").pop()!

      for (let i = 0; i < STAGES.length; i++) {
        const stageNumber = i + 1
        transition(ctx.db, PIPELINE_TRANSITIONS, `stage_${stageNumber}`)

        const childId = `${parentId}-stage-${stageNumber}`
        const existing = ctx.db.collections.children?.get(childId)
        const child = existing?.url
          ? await ctx.observe(entity(existing.url))
          : await ctx.spawn(
              "worker",
              childId,
              {
                systemPrompt: STAGES[i],
                tools: STAGE_TOOLS[i], // required for built-in worker, e.g. ["read", "edit"]
              },
              { initialMessage: currentInput, wake: "runFinished" }
            )
        if (!existing?.url) {
          ctx.db.actions.children_insert({ row: { key: childId, url: child.entityUrl, stage: stageNumber } })
        }

        currentInput = (await child.text()).join("\n\n")
      }

      transition(ctx.db, PIPELINE_TRANSITIONS, "done")
      return {
        content: [{ type: "text", text: currentInput }],
        details: {},
      }
    },
  }

  ctx.useAgent({ /* ... */, tools: [...ctx.electricTools, runPipelineTool] })
  await ctx.agent.run()
}
```

## Invariants

- **State machine enforces stage order.** `transition(status, PIPELINE_TRANSITIONS, nextStatus)` rejects out-of-order moves.
- **Deterministic stage IDs.** `${parentId}-stage-${stageNumber}` — stable across re-wakes.
- **Previous stage's text piped forward.** `currentInput = (await child.text()).join("\n\n")` after each stage.
- **Every `spawn` uses `wake: "runFinished"`.** The loop awaits each child's completion before moving to the next stage.
- **Spawn-once guard on each stage.** Re-wakes shouldn't re-spawn previously-completed stages.

## Pattern-specific review checklist

| #   | Rule                                                                                                      | Why                                                                     |
| --- | --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| P1  | `state.children` with stage tracking (`stage` field).                                                     | Needed to reconstruct pipeline position after re-wake.                  |
| P2  | `state.status` with explicit state-machine transitions (`idle → stage_1 → ... → stage_N → done`).         | Prevents out-of-order stages if the handler is re-invoked mid-pipeline. |
| P3  | Stage IDs use stage number (`${parentId}-stage-${n}`).                                                    | Stable across re-wakes.                                                 |
| P4  | Each stage's `spawn` sets `wake: "runFinished"`.                                                          | Otherwise the loop stalls waiting for child.                            |
| P5  | `STAGES` array is declared at module scope or as a constant inside the handler, not regenerated per wake. | Keeps stage count and prompts stable.                                   |
| P6  | Previous stage's output passed as `initialMessage` to next stage.                                         | Core pipeline semantics.                                                |
| P7  | Every spawn of the built-in `worker` passes a non-empty `tools` array.                                    | Built-in worker throws at parse time otherwise.                         |

## Anti-patterns

- **Spawning all stages at once.** Defeats the pipeline — use `map-reduce` instead.
- **No state machine.** On re-wake, logic restarts from stage 1; already-completed stages re-run.
- **Non-deterministic stage IDs.** Breaks the spawn-once guard.
- **Stage count varying per input.** That's `map-reduce` with a fixed transform, not pipeline.
