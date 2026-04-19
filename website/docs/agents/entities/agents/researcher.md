---
title: Researcher agent
titleTemplate: "... - Electric Agents"
description: >-
  Pre-built research agent with web search and URL fetch tool support.
outline: [2, 3]
---

# Researcher agent

Pre-built agent for research tasks. Accepts an optional array of custom tools at registration (e.g. web search, URL fetch).

**Source:** [`packages/ts-darix-runtime/src/agents/researcher.ts`](https://github.com/electric-sql/durable-streams/blob/main/packages/ts-darix-runtime/src/agents/researcher.ts)

## Registration

```ts
import { registerResearcherAgent } from "@durable-streams/darix-runtime"

registerResearcherAgent(tools, registry)
```

The `tools` parameter is an optional `Array<AgentTool>`. These are merged with `ctx.darixTools` at handler time.

## Definition

```ts
export function registerResearcherAgent(
  tools: Array<AgentTool> = [],
  registry?: EntityRegistry
): void {
  resolveDefine(registry)(`researcher`, {
    description: `Thorough research analyst with web search and URL fetching`,

    async handler(ctx) {
      ctx.configureAgent({
        systemPrompt: `You are a thorough research analyst. When given a question or topic:

1. Search the web to find current, relevant information
2. Fetch and read promising URLs for detailed content
3. Synthesize findings into a clear, well-organized response
4. Always cite your sources with URLs

Be thorough but concise. Prefer multiple sources over a single one. If information conflicts, note the disagreement. The current year is 2026.`,
        model: `claude-sonnet-4-5-20250929`,
        tools: [...ctx.darixTools, ...tools],
      })
      await ctx.agent.run()
    },
  })
}
```

## Details

| Property  | Value                                                  |
| --------- | ------------------------------------------------------ |
| Type name | `researcher`                                           |
| Model     | `claude-sonnet-4-5-20250929`                           |
| Tools     | `ctx.darixTools` + custom tools passed at registration |
| State     | None                                                   |

The system prompt instructs the agent to search the web, fetch URLs, synthesize findings, and cite sources.
