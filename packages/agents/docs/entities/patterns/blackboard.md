---
title: Blackboard (shared state)
titleTemplate: '... - Electric Agents'
description: >-
  Multi-agent coordination using shared state as a common data structure for reads and writes.
outline: [2, 3]
---

# Blackboard (shared state)

Pattern: multiple agents coordinate through a shared data structure. A parent creates shared state, spawns workers that connect to it, and workers read/write shared collections via auto-generated CRUD tools.

**Source:** [`packages/agents-runtime/skills/designing-entities/references/patterns/blackboard.md`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/skills/designing-entities/references/patterns/blackboard.md)

## Debate example

The canonical blackboard example: a moderator runs a structured debate between pro and con workers via shared state.

### Schema

```ts
const debateSchema = {
  arguments: {
    schema: z.object({
      key: z.string(),
      side: z.enum(['pro', 'con']),
      text: z.string(),
      round: z.number(),
    }),
    type: 'shared:argument',
    primaryKey: 'key',
  },
}
```

### Registration

```ts
import { db } from '@electric-ax/agents-runtime'

export function registerDebate(registry: EntityRegistry) {
  registry.define(`debate`, {
    description: `Debate moderator that creates shared state, spawns pro and con workers, and writes a final ruling based on arguments written to shared state`,
    state: {
      status: { primaryKey: `key` },
    },

    async handler(ctx) {
      if (ctx.firstWake) {
        ctx.db.actions.status_insert({ row: { key: `current`, value: `idle` } })
        ctx.mkdb(`debate-${ctx.entityUrl}`, debateSchema)
      }
      const shared = await ctx.observe(
        db(`debate-${ctx.entityUrl}`, debateSchema)
      )

      // ... create tools that reference `shared` ...

      ctx.useAgent({
        systemPrompt: DEBATE_SYSTEM_PROMPT,
        model: `claude-sonnet-4-5-20250929`,
        tools: [...ctx.electricTools, startTool, checkTool, endTool],
      })
      await ctx.agent.run()
    },
  })
}
```

### How it works

1. On first wake, the moderator creates shared state with `ctx.mkdb()`.
2. The moderator connects to the shared state with `ctx.observe(db(...))`.
3. The `start_debate` tool spawns pro and con workers, each connected to the same shared state:

```ts
const proWorker = await ctx.spawn(
  `worker`,
  `debate-pro-${Date.now()}-${spawnCounter}`,
  {
    systemPrompt: PRO_WORKER_PROMPT,
    sharedDb: { id: `debate-${ctx.entityUrl}`, schema: debateSchema },
  },
  { initialMessage: proInitialMessage, wake: `runFinished` }
)
```

4. Workers write arguments to the shared `arguments` collection using auto-generated `write_arguments` tools (see [Worker](../agents/worker.md)).
5. The `check_debate` tool reads the shared state to see current arguments:

```ts
const args = shared.arguments.toArray
```

6. The `end_debate` tool reads all arguments and transitions to `done`.

### State transitions

```ts
type DebateStatus = 'idle' | 'debating' | 'ruling' | 'done'
```

## Other blackboard variants

The same structure applies to other blackboard workflows:

- **Wiki** -- specialist workers collaboratively build a knowledge base. Each writes articles to a shared `articles` collection.
- **Peer review** -- workers submit reviews with scores and feedback to a shared `reviews` collection. A coordinator summarizes the reviews.
- **Trading floor** -- trader agents submit buy/sell orders to a shared `orders` collection and transition through market sessions.

All follow the same structure: parent creates shared state, spawns workers with `sharedDb` in their args, workers use generated CRUD tools to coordinate.
