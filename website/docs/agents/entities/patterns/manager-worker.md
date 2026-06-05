---
title: Manager-Worker
titleTemplate: "... - Electric Agents"
description: >-
  Coordination pattern where a parent spawns specialist children, waits for completion, and synthesizes results.
outline: [2, 3]
---

# Manager-Worker

Pattern: a parent agent spawns multiple specialist children, waits for all to complete, and synthesizes results.

**Source:** [`packages/agents-runtime/skills/designing-entities/references/patterns/manager-worker.md`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/skills/designing-entities/references/patterns/manager-worker.md)

## Registration

```ts
export function registerManagerWorker(registry: EntityRegistry) {
  registry.define(`manager-worker`, {
    description: `Manager agent that spawns optimist, pessimist, and pragmatist workers to analyze any question from multiple perspectives`,
    state: {
      children: { schema: managerChildSchema, primaryKey: `key` },
    },

    async handler(ctx) {
      const analyzeTool = createAnalyzeWithPerspectivesTool(ctx)

      ctx.useAgent({
        systemPrompt: MANAGER_SYSTEM_PROMPT,
        model: `claude-sonnet-4-5-20250929`,
        tools: [...ctx.electricTools, analyzeTool],
      })
      await ctx.agent.run()
    },
  })
}
```

## How it works

The manager defines a handler-scoped tool called `analyze_with_perspectives`. When the LLM calls this tool, it:

1. Spawns 3 worker children -- optimist, pessimist, pragmatist -- each with a different system prompt.
2. Sends the same question to all three as `initialMessage`.
3. Uses `wake: { on: 'runFinished', includeResponse: true }` so the manager is re-invoked as each child completes.
4. Collects results from `runFinished` wake payloads or shared state after workers finish.
5. Runs a synthesis step after all child-completion wakes have been recorded.

On subsequent calls, the tool reuses existing children via `ctx.observe()` and `child.send()` instead of spawning new ones.

## Spawn-or-reuse pattern

The core of the tool -- first-call spawns, subsequent calls reuse:

```ts
for (const perspective of PERSPECTIVES) {
  const existing = children.get(perspective.id)
  const childId = `${parentId}-${perspective.id}`

  if (!existing?.url) {
    // First time: spawn a new worker
    const child = await ctx.spawn(
      `worker`,
      childId,
      { systemPrompt: perspective.systemPrompt, tools: [`read`] },
      { initialMessage: question, wake: { on: `runFinished`, includeResponse: true } }
    )
    children.insert({
      key: perspective.id,
      url: child.entityUrl,
      kind: perspective.id,
      question,
    })
    handles.push({ id: perspective.id, handle: child })
    continue
  }

  // Subsequent calls: observe existing child and send new question
  const child = await ctx.observe(entity(existing.url))
  child.send(question)
  children.update(perspective.id, (draft) => {
    draft.question = question
  })
  handles.push({ id: perspective.id, handle: child })
}
```

## Collecting results

Do not wait for worker output inside the same wake. Spawn workers with `wake: { on: "runFinished", includeResponse: true }`, record each worker URL in manager state, and return. On each later child-completion wake, store `wake.payload.finished_child.response` (or read structured output from shared state). Once all workers have reported, run the reduce/synthesis step.

```ts
const finished = wake.payload?.finished_child
if (finished) {
  ctx.state.workers.update(finished.url, (draft) => {
    draft.status = finished.run_status
    draft.output = finished.response ?? ""
  })
}
```

## State

The `children` collection tracks spawned workers:

```ts
const managerChildSchema = z.object({
  key: z.string(),
  url: z.string(),
  kind: z.string(),
  question: z.string(),
})
```

This allows the manager to find and reuse children across handler invocations.
