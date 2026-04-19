---
title: Examples
titleTemplate: "... - Electric Agents"
description: >-
  Example applications demonstrating Electric Agents patterns and coordination.
outline: [2, 3]
---

# Examples

Working applications that demonstrate how to build with Electric Agents. Each example is a standalone project in the [`examples/`](https://github.com/electric-sql/durable-streams/tree/main/examples) directory of the repository.

### [Playground](/docs/agents/examples/playground)

A comprehensive example with **14 agent types** spanning standalone, coordination, blackboard, and reactive patterns. The best place to explore how Electric Agents works.

- Standalone assistant with calculator, database, memory, and search tools
- Coordination patterns: deep researcher, manager-worker, dispatcher, pipeline, map-reduce
- Shared state patterns: debate, peer review, wiki, trading floor
- Reactive observers: summarizer, monitor, guardian

```bash
cd examples/durable-agents-playground
pnpm dev
```

### [Mega Draw](/docs/agents/examples/mega-draw)

A collaborative multi-agent drawing app where **100 AI agents** each own a tile of a shared 1000×1000 pixel canvas and work together to produce a drawing from a single text prompt.

- Coordinator + worker pattern at scale (1 coordinator, 100 tile agents)
- Custom drawing tools scoped to each tile's region
- Live canvas viewer that updates in real-time as agents draw
- Follow-up instructions that re-instruct only affected tiles

```bash
cd examples/mega-draw
pnpm dev
```

### [Webhook Agents UI](/docs/agents/examples/grid-app)

A full-stack app built with **TanStack Start** that embeds the Durable Streams server and DARIX runtime in development. Creates task agents with web search and URL fetch tools, and displays real-time progress in a polished UI.

- Embedded dev server — one command to run everything
- Agent streaming with live markdown rendering
- TanStack DB for reactive state management

```bash
cd examples/webhook-agents-ui
pnpm dev
```

### [Grid App](/docs/agents/examples/grid-app)

A minimal production-ready app template. Two entity types, a clean registry pattern, and a webhook server — the simplest starting point for new projects.

- Two entity types (`assistant` and `runway`)
- Separate registry file with register functions
- HTTP webhook server with type registration on startup
