---
title: Playground
titleTemplate: "... - Electric Agents"
description: >-
  Technical examples for experimenting with Electric Agents coordination patterns.
outline: [2, 3]
---

# Playground

The [Electric Agents Playground](https://github.com/electric-sql/electric/tree/main/examples/agents-playground) is a collection of technical examples for trying coordination patterns against a local Electric Agents server.

## What it includes

The playground currently includes two entity patterns.

### Perspectives

Perspectives is a manager-worker example. A manager agent spawns an optimist and a critic to examine the same question from different viewpoints, then synthesizes their responses into a balanced analysis.

It demonstrates:

- Spawning child agents from a custom tool.
- Waking the manager when child runs finish.
- Tracking child entity URLs in state.
- Synthesizing worker outputs into a final response.

### Researcher

Researcher is a coordinator example. It decomposes complex research questions into specialist sub-questions, spawns workers for each slice, and synthesizes the findings into a comprehensive answer with citations.

It demonstrates:

- Dynamic fan-out based on the shape of the user's question.
- Specialist worker agents focused on distinct research tasks.
- Wake-on-finish coordination between coordinator and workers.
- Final synthesis from multiple child reports.

## Run it

Start the local agents infrastructure from the monorepo root:

```bash
npx electric-ax agents start
```

Then configure and run the playground:

```bash
cd examples/agents-playground
cp .env.example .env
pnpm install
pnpm dev
```

The app server starts on port `3000` and registers entity types with the agent server on port `4437`.

## Source

The source code is in [`examples/agents-playground`](https://github.com/electric-sql/electric/tree/main/examples/agents-playground).

See [spawning & coordinating](../usage/spawning-and-coordinating.md) for the underlying coordination concepts.
