---
title: Playground
titleTemplate: "... - Electric Agents"
description: >-
  Example app with 14 agent types spanning standalone, coordination, blackboard, and reactive patterns.
outline: [2, 3]
---

# Playground

The `durable-agents-playground` is an example application demonstrating Electric Agents patterns. Located at `examples/durable-agents-playground/` in the repository.

## What it includes

14 agent types organized into four categories.

### Standalone

- `assistant` --- general-purpose agent with calculator, database, memory, dice, and inventory tools

### Coordination

- `worker` --- generic configurable child agent (prompt and shared state via spawn args)
- `deep-researcher` --- spawns specialist sub-agents for deep research
- `manager-worker` --- multi-perspective analysis (optimist/pessimist/pragmatist)
- `dispatcher` --- routes tasks to the appropriate agent type
- `pipeline` --- sequential worker stages
- `map-reduce` --- parallel chunk processing

### Blackboard (shared state)

- `debate` --- pro/con workers with shared argument state
- `peer-review` --- multiple reviewers evaluating an artifact
- `wiki` --- 7 category specialists building a knowledge base
- `trading-floor` --- traders with shared market state

### Reactive

- `summarizer` --- observes entity streams, produces summaries
- `monitor` --- watches multiple entities, reports status changes
- `guardian` --- quality control observer

## Running it

```bash
cd examples/durable-agents-playground
pnpm install
cp ../../.env.template .env  # Set ANTHROPIC_API_KEY
pnpm dev
```

Requires a running runtime server at `http://localhost:4437` (default).

## Project structure

```
src/
├── server.ts                 # Entry point, registry, HTTP server
├── guards.ts                 # State transition validation
├── standalone/assistant.ts   # Standalone assistant
├── workers/worker.ts         # Generic worker
├── coordination/             # Coordination patterns
├── blackboard/               # Shared state patterns
├── reactive/                 # Observer patterns
└── tools/                    # Tool definitions
    ├── registry.ts           # Tool factory registry
    ├── calculator.ts
    ├── memory-store.ts
    ├── sqlite.ts
    ├── inventory.ts
    ├── dice-roll.ts
    ├── web-search.ts
    ├── fetch-url.ts
    └── observe.ts
```

See [Agents & Patterns](../usage/spawning-and-coordinating.md) for detailed documentation of each pattern.
