---
title: Horton agent
titleTemplate: "... - Electric Agents"
description: >-
  The built-in Horton assistant - chat, research, code, and dispatch subagents in one entity type.
outline: [2, 3]
---

# Horton agent

The built-in assistant registered by the Electric Agents dev server. Horton can chat conversationally, search the web, read and edit files, run shell commands, and dispatch workers for isolated subtasks.

**Source:** [`packages/agents/src/agents/horton.ts`](https://github.com/electric-sql/electric/blob/main/packages/agents/src/agents/horton.ts)

## Try it

With the dev server running (`npx electric-ax agents quickstart`):

```sh
npx electric-ax agents spawn /horton/my-horton
npx electric-ax agents send /horton/my-horton 'What's in this directory?'
npx electric-ax agents observe /horton/my-horton
```

## Tools

Horton is configured with `ctx.electricTools` plus the base Horton tool set:

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

When docs support or skills are available, Horton also adds the docs search tool and skill tools during bootstrap.

## Title generation

After the first agent run completes, Horton calls `generateTitle()` (Haiku) to summarise the user's first message into a 3-5 word session title and stores it via `ctx.setTag('title', title)`. Failures are logged and ignored — the entity continues without a title.

## Details

| Property          | Value                                             |
| ----------------- | ------------------------------------------------- |
| Type name         | `horton`                                          |
| Model             | `HORTON_MODEL` (`claude-sonnet-4-5-20250929`)     |
| Title model       | `claude-haiku-4-5-20251001`                       |
| Tools             | `ctx.electricTools` + base Horton tool set, plus docs/skill tools when configured |
| Working directory | Passed at bootstrap (defaults to `process.cwd()`) |
| Title generation  | Yes, after the first run if no title tag exists   |

## Extending Horton

The system prompt and tool factory are exported so you can build your own variants:

```ts
import {
  HORTON_MODEL,
  buildHortonSystemPrompt,
  createHortonTools,
} from "@electric-ax/agents"

registry.define("my-assistant", {
  description: "Horton with an extra custom tool",
  async handler(ctx) {
    const readSet = new Set<string>()
    ctx.useAgent({
      systemPrompt: buildHortonSystemPrompt(process.cwd()),
      model: HORTON_MODEL,
      tools: [
        ...ctx.electricTools,
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
