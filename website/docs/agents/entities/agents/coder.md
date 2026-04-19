---
title: Coder agent
titleTemplate: "... - Electric Agents"
description: >-
  Pre-built developer agent with shell and file access tool support.
outline: [2, 3]
---

# Coder agent

Pre-built agent for code-related tasks. Accepts an optional array of custom tools at registration (e.g. shell access, file read/write).

**Source:** [`packages/ts-darix-runtime/src/agents/coder.ts`](https://github.com/electric-sql/durable-streams/blob/main/packages/ts-darix-runtime/src/agents/coder.ts)

## Registration

```ts
import { registerCoderAgent } from "@durable-streams/darix-runtime"

registerCoderAgent(tools, registry)
```

The `tools` parameter is an optional `Array<AgentTool>`.

## Definition

```ts
export function registerCoderAgent(
  tools: Array<AgentTool> = [],
  registry?: EntityRegistry
): void {
  resolveDefine(registry)(`coder`, {
    description: `Pragmatic developer with shell and file access`,

    async handler(ctx) {
      const workingDirectory =
        typeof ctx.args.working_directory === `string`
          ? ctx.args.working_directory
          : `.`

      ctx.configureAgent({
        systemPrompt: `You are a pragmatic software developer. You can read files and run shell commands to explore codebases, debug issues, and explain code.

Guidelines:
- Explain what you're doing and why as you work
- Read files before suggesting changes
- Use bash for exploration (ls, find, grep) and execution
- Keep solutions simple and focused
- Working directory: ${workingDirectory}

The current year is 2026.`,
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
| Type name | `coder`                                                |
| Model     | `claude-sonnet-4-5-20250929`                           |
| Tools     | `ctx.darixTools` + custom tools passed at registration |
| State     | None                                                   |

The handler reads `ctx.args.working_directory` (defaults to `.`) and interpolates it into the system prompt.
