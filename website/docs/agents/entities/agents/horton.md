---
title: Horton agent
titleTemplate: "... - Electric Agents"
description: >-
  The built-in Horton assistant - chat, research, code, and dispatch subagents in one entity type.
outline: [2, 3]
---

# Horton agent

The built-in assistant registered by the Electric Agents dev server. Horton can chat conversationally, search the web, read and edit files, run shell commands, and dispatch subagents (workers) for isolated subtasks.

**Source:** [`packages/ts-darix-server/src/darix-agents/agents/horton.ts`](https://github.com/electric-sql/durable-streams/blob/main/packages/ts-darix-server/src/darix-agents/agents/horton.ts)

## Try it

With the dev server running (`pnpm start:darix`):

```sh
pnpm darix spawn /horton/my-horton
pnpm darix send /horton/my-horton 'What's in this directory?'
pnpm darix observe /horton/my-horton
```

## Tools

Horton is configured with `ctx.darixTools` plus the seven Horton tools:

| Tool           | Purpose                                                  |
| -------------- | -------------------------------------------------------- |
| `bash`         | Run shell commands in the working directory.             |
| `read`         | Read a file. Tracked in a per-wake `readSet`.            |
| `write`        | Create or overwrite a file.                              |
| `edit`         | Targeted string replacement (file must be `read` first). |
| `brave_search` | Web search via the Brave Search API.                     |
| `fetch_url`    | Fetch a URL and return it as markdown.                   |
| `spawn_worker` | Dispatch a subagent for an isolated subtask.             |

`brave_search` requires `BRAVE_SEARCH_API_KEY` in the environment; without it the tool errors at call time.

## Title generation

On the first wake, Horton calls `generateTitle()` (Haiku) to summarise the user's first message into a 3-5 word session title and stores it via `ctx.setTag('title', title)`. Failures are logged and ignored — the entity continues without a title.

## Details

| Property          | Value                                             |
| ----------------- | ------------------------------------------------- |
| Type name         | `horton`                                          |
| Model             | `HORTON_MODEL` (`claude-sonnet-4-5-20250929`)     |
| Title model       | `claude-haiku-4-5-20251001`                       |
| Tools             | `ctx.darixTools` + Horton tool set (7 tools)      |
| Working directory | Passed at bootstrap (defaults to `process.cwd()`) |
| Title generation  | Yes, on first wake                                |

## Extending Horton

The system prompt and tool factory are exported so you can build your own variants:

```ts
import {
  HORTON_MODEL,
  buildHortonSystemPrompt,
  createHortonTools,
} from "@durable-streams/ts-darix-server"

registry.define("my-assistant", {
  description: "Horton with an extra custom tool",
  async handler(ctx) {
    const readSet = new Set<string>()
    ctx.useAgent({
      systemPrompt: buildHortonSystemPrompt(process.cwd()),
      model: HORTON_MODEL,
      tools: [
        ...ctx.darixTools,
        ...createHortonTools(process.cwd(), ctx, readSet),
        myCustomTool,
      ],
    })
    await ctx.agent.run()
  },
})
```

## Related

- [Worker](./worker) — the subagent type Horton dispatches via `spawn_worker`.
