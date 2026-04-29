---
title: Defining tools
titleTemplate: '... - Electric Agents'
description: >-
  Create stateless, stateful, and handler-scoped tools for the LLM agent loop.
outline: [2, 3]
---

# Defining tools

Tools are functions the LLM can call during the agent loop. Each tool has a name, description, typed parameters, and an execute function.

## AgentTool interface

Re-exported from [`@mariozechner/pi-agent-core`](https://github.com/badlogic/pi-mono):

```ts
interface AgentTool<TParameters extends TSchema = TSchema, TDetails = any> {
  name: string
  label: string
  description: string
  parameters: TParameters
  execute: (
    toolCallId: string,
    params: Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>
  ) => Promise<AgentToolResult<TDetails>>
}
```

The return type:

```ts
interface AgentToolResult<T = any> {
  content: Array<{ type: 'text'; text: string }>
  details: T
}
```

## Parameters

Defined using [TypeBox](https://github.com/sinclairzx81/typebox) (`@sinclair/typebox`). The schema is used for LLM function calling and argument validation.

```ts
import { Type } from '@sinclair/typebox'

parameters: Type.Object({
  expression: Type.String({ description: 'Math expression to evaluate' }),
  precision: Type.Optional(Type.Number({ description: 'Decimal places' })),
})
```

## Stateless tools

Pure functions with no side effects beyond what they compute. Define directly as an `AgentTool` object.

```ts
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@electric-ax/agents-runtime'

const calculatorTool: AgentTool = {
  name: 'calculator',
  label: 'Calculator',
  description: 'Evaluate mathematical expressions.',
  parameters: Type.Object({
    expression: Type.String({ description: 'The expression to evaluate' }),
  }),
  execute: async (_toolCallId, params) => {
    const { expression } = params as { expression: string }
    const result = evaluate(expression)
    return {
      content: [{ type: 'text', text: String(result) }],
      details: {},
    }
  },
}
```

## Stateful tools

Use a factory function that receives the `HandlerContext`. The state persists across wakes -- it is backed by the entity's durable stream. Reads go through `ctx.db.collections` and writes go through `ctx.db.actions`.

```ts
import { Type } from '@sinclair/typebox'
import type { AgentTool, HandlerContext } from '@electric-ax/agents-runtime'

function createMemoryStoreTool(ctx: HandlerContext): AgentTool {
  return {
    name: 'memory_store',
    label: 'Memory Store',
    description: 'Persistent key-value store.',
    parameters: Type.Object({
      operation: Type.Union([
        Type.Literal('get'),
        Type.Literal('set'),
        Type.Literal('delete'),
        Type.Literal('list'),
      ]),
      key: Type.Optional(Type.String()),
      value: Type.Optional(Type.String()),
    }),
    execute: async (_, params) => {
      const { operation, key, value } = params as {
        operation: string
        key?: string
        value?: string
      }
      if (operation === 'set') {
        const existing = ctx.db.collections.kv?.get(key!)
        if (existing) {
          ctx.db.actions.kv_update({
            key: key!,
            updater: (draft) => {
              draft.value = value!
            },
          })
        } else {
          ctx.db.actions.kv_insert({ row: { key: key!, value: value! } })
        }
        return {
          content: [{ type: 'text', text: `Stored "${key}"` }],
          details: {},
        }
      }
      if (operation === 'get') {
        const entry = ctx.db.collections.kv?.get(key!)
        const text = entry ? entry.value : `No value found for "${key}"`
        return { content: [{ type: 'text', text }], details: {} }
      }
      if (operation === 'delete') {
        ctx.db.actions.kv_delete({ key: key! })
        return {
          content: [{ type: 'text', text: `Deleted "${key}"` }],
          details: {},
        }
      }
      // list
      const entries = ctx.db.collections.kv?.toArray ?? []
      const text = entries.map((e) => `${e.key}: ${e.value}`).join('\n')
      return {
        content: [{ type: 'text', text: text || '(empty)' }],
        details: {},
      }
    },
  }
}
```

The entity state API:

| Operation | Write (via `ctx.db.actions`)                                       | Read (via `ctx.db.collections`)       |
| --------- | ------------------------------------------------------------------ | ------------------------------------- |
| Insert    | `ctx.db.actions.<coll>_insert({ row: {...} })`                     | -                                     |
| Update    | `ctx.db.actions.<coll>_update({ key, updater: (draft) => {...} })` | -                                     |
| Delete    | `ctx.db.actions.<coll>_delete({ key })`                            | -                                     |
| Get       | -                                                                  | `ctx.db.collections.<coll>?.get(key)` |
| List      | -                                                                  | `ctx.db.collections.<coll>?.toArray`  |

## Handler-scoped tools

Use a factory that receives the `HandlerContext`. These tools can spawn entities, observe streams, send messages, and use any other `ctx` primitive.

```ts
import { Type } from '@sinclair/typebox'
import type { AgentTool, HandlerContext } from '@electric-ax/agents-runtime'

function createDispatchTool(ctx: HandlerContext): AgentTool {
  return {
    name: 'dispatch',
    label: 'Dispatch',
    description: 'Spawn a child agent and wait for its response.',
    parameters: Type.Object({
      type: Type.String({ description: 'Entity type to spawn' }),
      systemPrompt: Type.String({ description: 'System prompt for the child' }),
      task: Type.String({ description: 'Task to send to the child' }),
    }),
    execute: async (_, params) => {
      const { type, systemPrompt, task } = params as {
        type: string
        systemPrompt: string
        task: string
      }
      const child = await ctx.spawn(
        type,
        `dispatch-${Date.now()}`,
        { systemPrompt },
        {
          initialMessage: task,
          wake: 'runFinished',
        }
      )
      const text = (await child.text()).join('\n\n')
      return {
        content: [{ type: 'text', text }],
        details: {},
      }
    },
  }
}
```

`ctx.spawn` returns an `EntityHandle`. Passing `wake: 'runFinished'` means the parent will be woken when the child's agent run completes. `child.text()` returns all text outputs from the child's stream.

## Wiring tools together

Tools are constructed in the handler and passed to `useAgent`. Include `ctx.electricTools` when your runtime host provides runtime-level tools that the LLM should be able to call:

```ts
registry.define('assistant', {
  description: 'An assistant with memory and delegation',
  state: {
    kv: { primaryKey: 'key' },
  },
  async handler(ctx) {
    const memoryTool = createMemoryStoreTool(ctx)
    const dispatchTool = createDispatchTool(ctx)

    ctx.useAgent({
      systemPrompt: 'You are a helpful assistant with persistent memory.',
      model: 'claude-sonnet-4-5-20250929',
      tools: [...ctx.electricTools, memoryTool, dispatchTool, calculatorTool],
    })
    await ctx.agent.run()
  },
})
```

When you include `ctx.electricTools`, spread them before your custom tools so host-provided primitives keep their expected order.
