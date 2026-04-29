---
title: Pattern references
titleTemplate: '... - Electric Agents'
description: >-
  Electric Agents pattern references for standalone, coordination, blackboard, and reactive designs.
outline: [2, 3]
---

# Pattern references

Electric Agents pattern references live in the monorepo under `packages/agents-runtime/skills/designing-entities/references/patterns/`.

## What it includes

The patterns are organized into four categories.

### Standalone

- `single-agent` --- one entity handles the full task itself

### Coordination

- `manager-worker` --- multi-perspective analysis (optimist/pessimist/pragmatist)
- `dispatcher` --- routes tasks to the appropriate agent type
- `pipeline` --- sequential worker stages
- `map-reduce` --- parallel chunk processing

### Blackboard (shared state)

- `blackboard` --- multiple workers coordinate through shared state

### Reactive

- `reactive-observers` --- observes entity streams and reacts to changes

## Source references

- [`single-agent`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/skills/designing-entities/references/patterns/single-agent.md)
- [`manager-worker`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/skills/designing-entities/references/patterns/manager-worker.md)
- [`dispatcher`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/skills/designing-entities/references/patterns/dispatcher.md)
- [`pipeline`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/skills/designing-entities/references/patterns/pipeline.md)
- [`map-reduce`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/skills/designing-entities/references/patterns/map-reduce.md)
- [`blackboard`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/skills/designing-entities/references/patterns/blackboard.md)
- [`reactive-observers`](https://github.com/electric-sql/electric/blob/main/packages/agents-runtime/skills/designing-entities/references/patterns/reactive-observers.md)

See [Agents & Patterns](../usage/spawning-and-coordinating.md) for detailed documentation of each pattern.
