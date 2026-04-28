---
title: Reactive observers
titleTemplate: '... - Electric Agents'
description: >-
  Pattern for entities that watch others and react to changes using ctx.observe() with wake conditions.
outline: [2, 3]
---

# Reactive observers

Pattern: entities that watch other entities and react to changes.

**Source:** [`packages/agents-runtime/skills/designing-entities/references/patterns/reactive-observers.md`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/skills/designing-entities/references/patterns/reactive-observers.md)

## Core mechanism

An entity calls `ctx.observe(entity(entityUrl), { wake: { on: 'change', collections: [...] } })` to start watching another entity. The `entity()` helper (imported from `@electric-ax/agents-runtime`) wraps a raw URL into the correct observe target. When the observed entity has new activity in the specified collections, the observer is woken.

## Monitor example

The monitor watches multiple entities and reports status changes.

**Source:** [`packages/agents-runtime/skills/designing-entities/references/patterns/reactive-observers.md`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/skills/designing-entities/references/patterns/reactive-observers.md)

```ts
export function registerMonitor(registry: EntityRegistry) {
  registry.define(`monitor`, {
    description: `Health dashboard agent that watches multiple entities and reports status changes and anomalies`,
    state: {
      status: { primaryKey: `key` },
    },

    async handler(ctx) {
      if (ctx.firstWake) {
        ctx.db.actions.status_insert({ row: { key: `current`, value: `idle` } })
      }
      const baseObserveTool = createObserveTool(ctx)
      const observeTool = {
        ...baseObserveTool,
        execute: async (toolCallId: string, params: unknown) => {
          ctx.db.actions.status_update({
            key: `current`,
            updater: (draft) => {
              draft.value = `observing`
            },
          })
          return baseObserveTool.execute(toolCallId, params)
        },
      }

      ctx.useAgent({
        systemPrompt: MONITOR_SYSTEM_PROMPT,
        model: `claude-sonnet-4-5-20250929`,
        tools: [...ctx.electricTools, observeTool],
      })
      await ctx.agent.run()
    },
  })
}
```

The monitor wraps the base observe tool to also transition its own state to `observing`.

## The observe tool

The `observe_entity` tool lets the LLM decide what to watch:

```ts
import { entity } from '@electric-ax/agents-runtime'

export function createObserveTool(ctx: HandlerContext): AgentTool {
  return {
    name: `observe_entity`,
    label: `Observe Entity`,
    description: `Start observing another entity by its URL. The current entity will wake with a change payload when the observed entity has new activity.`,
    parameters: Type.Object({
      entity_url: Type.String({
        description: `The URL of the entity to observe`,
      }),
      collections: Type.Optional(
        Type.Array(Type.String(), {
          description: `Which collections to watch (default: all). Options: texts, textDeltas, runs, toolCalls, childStatus`,
        })
      ),
    }),
    execute: async (_toolCallId, params) => {
      const { entity_url, collections } = params as {
        entity_url: string
        collections?: string[]
      }
      try {
        await ctx.observe(entity(entity_url), {
          wake: { on: `change`, collections },
        })
        return {
          content: [
            {
              type: `text`,
              text: `Now observing entity: ${entity_url}. You will be woken when new activity is detected.`,
            },
          ],
          details: {},
        }
      } catch (err) {
        return {
          content: [
            {
              type: `text`,
              text: `Error observing entity: ${err instanceof Error ? err.message : `Unknown error`}`,
            },
          ],
          details: {},
        }
      }
    },
  }
}
```

## Other reactive variants

- **Summarizer** -- observes an entity's `texts` and `textDeltas` collections and produces progressive summaries of its output.
- **Guardian** -- observes an entity's `texts` and `toolCalls` collections and evaluates output quality, checking for hallucination signals, safety issues, and formatting problems.

All three follow the same structure: register an entity, wrap `createObserveTool` with a state transition, configure the agent with the observe tool, and run.
