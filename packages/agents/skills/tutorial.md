---
description: Interactive tutorial — build a perspectives analyzer entity with the manager-worker pattern
whenToUse: User asks about building entities, wants a tutorial, is new to Electric Agents, or wants to learn multi-agent patterns
keywords:
  - tutorial
  - getting started
  - learn
  - multi-agent
  - manager-worker
  - perspectives
  - entity
user-invocable: true
max: 25000
---

# Tutorial: Build a Perspectives Analyzer

Build a `perspectives` entity that analyzes questions from an optimist and a critic using the manager-worker pattern. Use the exact code below — do not invent different code.

## Before starting

Read `server.ts` in the working directory:

- **Has `registerPerspectives`**: resume from where they left off (read `entities/perspectives.ts` to determine the step)
- **Has `server.ts` but no perspectives**: go to Step 1
- **No `server.ts`**: scaffold the project — spawn a worker (`tools: ["bash"]`, systemPrompt: `"Set up an Electric Agents app project."`, initialMessage: `"mkdir -p TARGET/lib TARGET/entities && cp SKILL_DIR/scaffold/* TARGET/ && cp SKILL_DIR/scaffold/lib/* TARGET/lib/ && cp SKILL_DIR/scaffold/.env TARGET/ && cd TARGET && pnpm install && pnpm dev &"` — replace SKILL_DIR and TARGET). Then proceed to Step 1 while the worker runs. Wait for the worker to finish before writing files.

## Steps

**Step 1 — Welcome + first entity.** In one message: briefly introduce Electric Agents (durable streams backing agent sessions — use your docs knowledge), preview the perspectives analyzer, and show the Step 1 code. Ask to write.

**Step 2 — After confirmation:** write `entities/perspectives.ts` with Step 1 code. Give CLI commands. Explain spawning briefly, show Step 2 code (adds one worker). Ask to write.

**Step 3 — After confirmation:** write the updated file. Give CLI commands. Explain coordination, show Step 3 code (adds critic + state). Ask to write.

**Step 4 — After confirmation:** write the updated file. Give CLI commands.

**Step 5 — Wire up.** Read `server.ts`, show the import change, ask to write, update it.

**Step 6 — Recap.**

## Rules

- Use the exact code below. Write files with your write tool.
- `server.ts` is at the working directory root. Entity files go in `entities/`.
- Worker spawn args MUST include `tools` array (e.g. `tools: ["bash", "read"]`).
- Prefer showing what changed between steps rather than repeating the entire file.
- Use `edit` tool for small changes (like updating server.ts). Use `write` for full entity file updates.

---

# Code

## Step 1: Minimal entity

`entities/perspectives.ts`:

```typescript
import type { EntityRegistry } from '@electric-ax/agents-runtime'

export function registerPerspectives(registry: EntityRegistry) {
  registry.define('perspectives', {
    description: 'Analyzes questions from multiple perspectives',
    async handler(ctx) {
      ctx.useAgent({
        systemPrompt:
          'You are a balanced analyst. When given a question, provide a thoughtful analysis.',
        model: 'claude-sonnet-4-6',
        tools: [...ctx.electricTools],
      })
      await ctx.agent.run()
    },
  })
}
```

`server.ts` additions:

```typescript
import { registerPerspectives } from './entities/perspectives'
registerPerspectives(registry)
```

Test: `pnpm electric-agents spawn /perspectives/test-1 && pnpm electric-agents send /perspectives/test-1 "Is remote work better than office work?" && pnpm electric-agents observe /perspectives/test-1`

## Step 2: One worker

Full `entities/perspectives.ts`:

```typescript
import type {
  EntityRegistry,
  HandlerContext,
} from '@electric-ax/agents-runtime'
import { Type } from '@sinclair/typebox'

function createAnalyzeTool(ctx: HandlerContext) {
  return {
    name: 'analyze_question',
    label: 'Analyze Question',
    description: 'Spawns an optimist worker to analyze a question.',
    parameters: Type.Object({
      question: Type.String({ description: 'The question to analyze' }),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const { question } = params as { question: string }
      const parentId = ctx.entityUrl.split('/').pop()
      await ctx.spawn(
        'worker',
        `${parentId}-optimist`,
        {
          systemPrompt:
            'You are an optimist analyst. Provide an enthusiastic, positive analysis focusing on opportunities and benefits.',
          tools: ['bash', 'read'],
        },
        { initialMessage: question, wake: 'runFinished' }
      )
      return {
        content: [
          {
            type: 'text' as const,
            text: "Spawned optimist worker. You'll be woken when it finishes.",
          },
        ],
        details: {},
      }
    },
  }
}

export function registerPerspectives(registry: EntityRegistry) {
  registry.define('perspectives', {
    description: 'Analyzes questions from multiple perspectives',
    async handler(ctx) {
      ctx.useAgent({
        systemPrompt: `You are a balanced analyst.\n\nWhen given a question:\n1. Call analyze_question with the question.\n2. End your turn. You'll be woken when the worker finishes.\n3. When woken, finished_child.response contains the analysis.\n4. Present it to the user.`,
        model: 'claude-sonnet-4-6',
        tools: [...ctx.electricTools, createAnalyzeTool(ctx)],
      })
      await ctx.agent.run()
    },
  })
}
```

Test: `pnpm electric-agents spawn /perspectives/test-2 && pnpm electric-agents send /perspectives/test-2 "Is remote work better than office work?" && pnpm electric-agents observe /perspectives/test-2`

## Step 3: Two workers + state

Full `entities/perspectives.ts`:

```typescript
import type {
  EntityRegistry,
  HandlerContext,
} from '@electric-ax/agents-runtime'
import { Type } from '@sinclair/typebox'

const PERSPECTIVES = [
  {
    id: 'optimist',
    systemPrompt:
      'You are an optimist analyst. Provide an enthusiastic, positive analysis focusing on opportunities and benefits.',
  },
  {
    id: 'critic',
    systemPrompt:
      'You are a critical analyst. Provide a sharp analysis focusing on risks, downsides, and challenges.',
  },
]

function createAnalyzeTool(ctx: HandlerContext) {
  return {
    name: 'analyze_question',
    label: 'Analyze Question',
    description: 'Spawns optimist and critic workers to analyze a question.',
    parameters: Type.Object({
      question: Type.String({ description: 'The question to analyze' }),
    }),
    execute: async (_toolCallId: string, params: unknown) => {
      const { question } = params as { question: string }
      const parentId = ctx.entityUrl.split('/').pop()
      for (const p of PERSPECTIVES) {
        const childId = `${parentId}-${p.id}`
        await ctx.spawn(
          'worker',
          childId,
          { systemPrompt: p.systemPrompt, tools: ['bash', 'read'] },
          { initialMessage: question, wake: 'runFinished' }
        )
        ctx.db.actions.children_insert({
          row: { key: p.id, url: `/worker/${childId}` },
        })
      }
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Spawned optimist and critic workers.',
          },
        ],
        details: {},
      }
    },
  }
}

export function registerPerspectives(registry: EntityRegistry) {
  registry.define('perspectives', {
    description:
      'Analyzes questions from two perspectives: optimist and critic',
    state: { children: { primaryKey: 'key' } },
    async handler(ctx) {
      ctx.useAgent({
        systemPrompt: `You are a balanced analyst.\n\n1. Call analyze_question with the question.\n2. End your turn. You'll be woken as each worker finishes.\n3. Each wake includes finished_child.response and other_children.\n4. Once both are done, synthesize a balanced response.`,
        model: 'claude-sonnet-4-6',
        tools: [...ctx.electricTools, createAnalyzeTool(ctx)],
      })
      await ctx.agent.run()
    },
  })
}
```

Test: `pnpm electric-agents spawn /perspectives/test-3 && pnpm electric-agents send /perspectives/test-3 "Is remote work better than office work?" && pnpm electric-agents observe /perspectives/test-3`

## What you learned

- `registry.define()` — entity types with description, state, handler
- `ctx.useAgent()` + `ctx.agent.run()` — configure and run an LLM agent
- `ctx.spawn()` — spawn child entities with custom prompts
- Wake events — parents wake when children finish
- State collections — track data across wakes
- The worker pattern — one generic type, many roles
