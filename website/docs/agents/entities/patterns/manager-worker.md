---
title: Manager-Worker
titleTemplate: "... - Electric Agents"
description: >-
  Coordination pattern where a parent spawns specialist children, waits for completion, and synthesizes results.
outline: [2, 3]
---

# Manager-Worker

Pattern: a parent agent spawns multiple specialist children, waits for all to complete, and synthesizes results.

**Source:** [`examples/durable-agents-playground/src/coordination/manager-worker.ts`](https://github.com/electric-sql/durable-streams/blob/main/examples/durable-agents-playground/src/coordination/manager-worker.ts)

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
        tools: [...ctx.darixTools, analyzeTool],
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
3. Uses `wake: 'runFinished'` to wait for each child to complete.
4. Collects results with `Promise.all` and `handle.text()`.
5. Returns the combined perspectives to the LLM for synthesis.

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
      { systemPrompt: perspective.systemPrompt },
      { initialMessage: question, wake: `runFinished` }
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

The `readLatestCompletedText` helper awaits the child's current run, reads all text outputs, and returns the last one:

```ts
async function readLatestCompletedText(
  handle: EntityHandle,
  fallback: string
): Promise<string> {
  await handle.run
  const runs = await handle.text()
  const latest = runs[runs.length - 1]?.trim()
  return latest || fallback
}

const results = await Promise.all(
  handles.map(async ({ id, handle }) => ({
    id,
    text: await readLatestCompletedText(
      handle,
      `(no completed output from ${id})`
    ),
  }))
)
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
