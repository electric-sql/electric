---
title: Deep Survey
description: >-
  Multi-agent research app where an orchestrator coordinates a swarm of explorer
  agents to build a live knowledge base.
source_url: https://github.com/electric-sql/electric/tree/main/examples/deep-survey
image: /img/demos/deep-survey-demo.jpg
demo: true
order: 20
---

# Deep Survey

Deep Survey is a multi-agent research app powered by [Electric Agents](/docs/agents/). An orchestrator coordinates a swarm of explorer agents that research a target in parallel, write wiki entries, and cross-reference their findings in shared state.

<DemoCTAs :demo="$frontmatter" />

## How it works

You provide a target topic, codebase, or subject to explore. The orchestrator performs initial research, decomposes the target into subtopics, and spawns explorer agents to investigate them in parallel.

Each explorer writes a concise wiki entry and records cross-references to related entries. The live dashboard shows agent status, the growing knowledge graph, wiki entries, and recent activity as the swarm runs.

Once the survey completes, the chat sidebar can ask follow-up questions against the accumulated wiki.

## What it demonstrates

- Orchestrator and worker entities coordinating through shared state.
- Dynamic fan-out to many explorer agents based on the requested target.
- Real-time UI subscriptions over agent status, wiki entries, and cross-reference data.
- Tool use for web search, URL fetching, wiki writes, and knowledge retrieval.

## Source

The demo source is in [`examples/deep-survey`](https://github.com/electric-sql/electric/tree/main/examples/deep-survey).

See the [spawning & coordinating guide](/docs/agents/usage/spawning-and-coordinating) and [shared state guide](/docs/agents/usage/shared-state) for the supporting concepts.

<DemoCTAs :demo="$frontmatter" />
