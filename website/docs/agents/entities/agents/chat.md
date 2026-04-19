---
title: Chat agent
titleTemplate: "... - Electric Agents"
description: >-
  Pre-built conversational agent with system prompt optimized for friendly dialogue.
outline: [2, 3]
---

# Chat agent

The simplest pre-built agent. Accepts messages and responds conversationally. No custom state.

**Source:** [`packages/ts-darix-runtime/src/agents/chat.ts`](https://github.com/electric-sql/durable-streams/blob/main/packages/ts-darix-runtime/src/agents/chat.ts)

## Registration

```ts
import { registerChatAgent } from "@durable-streams/darix-runtime"

registerChatAgent(registry)
```

## Definition

```ts
resolveDefine(registry)(`chat`, {
  description: `Friendly conversational assistant`,

  async handler(ctx) {
    ctx.configureAgent({
      systemPrompt: `You are a friendly, helpful conversational assistant. Be warm and engaging while providing accurate, thoughtful responses. Keep your answers clear and concise. The current year is 2026.`,
      model: `claude-sonnet-4-5-20250929`,
      tools: [...ctx.darixTools],
    })
    await ctx.agent.run()
  },
})
```

## Details

| Property  | Value                        |
| --------- | ---------------------------- |
| Type name | `chat`                       |
| Model     | `claude-sonnet-4-5-20250929` |
| Tools     | `ctx.darixTools` only        |
| State     | None                         |

The handler calls `configureAgent` with a system prompt and the default built-in tools, then runs the agent. Nothing else.
