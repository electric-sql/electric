---
title: "Durable\u00A0Streams \u2014 the data primitive for the\u00A0agent\u00A0loop"
description: >-
  Agents are stateful. The agent loop accumulates a new kind of data that needs a new kind of primitive. Durable Streams is that primitive.
excerpt: >-
  Agents are stateful. The agent loop accumulates a new kind of data that needs a new kind of primitive. Durable Streams is that primitive.
authors: [thruflo]
image: /img/blog/data-primitive-agent-loop/header.jpg
tags: [durable-streams, agents, sync]
outline: [2, 3]
post: true
published: true
---

<script setup>
import Card from '../../src/components/home/Card.vue'
import AgentLoopAnimation from '../../src/components/blog/data-primitive-agent-loop/AgentLoopAnimation.vue'
</script>

The agent loop accumulates state: messages, token streams, tool calls and results. A new kind of data that needs a new data&nbsp;primitive.

[Durable&nbsp;Streams](https://durablestreams.com) are persistent, addressable, real-time streams. Reactive, resumable and extensible, they are the data primitive for the agent&nbsp;loop.

> [!Warning] <img src="/img/icons/durable-streams.square.svg" style="height: 20px; margin-right: 6px; margin-top: -1px; display: inline; vertical-align: text-top" /> Dive into Durable&nbsp;Streams
> See the [docs](https://durablestreams.com), [transports](/blog/2026/03/24/durable-transport-ai-sdks), [extensions](/blog/2026/03/26/stream-db), [examples](https://github.com/durable-streams/durable-streams/tree/main/examples) and [deploy&nbsp;now](https://dashboard.electric-sql.cloud/?intent=create&serviceType=streams) on [Electric&nbsp;Cloud](/cloud).

## The agent loop

Agents are being deployed at massive and accelerating scale. The core execution pattern behind them is the agent loop: a cycle of observe → think → act → repeat.

The agent receives a task, reasons about what to do, decides on an action, executes it and then feeds the result back into its own context as a new observation.

<figure>
  <Card>
    <ClientOnly>
      <AgentLoopAnimation />
    </ClientOnly>
  </Card>
</figure>

This loop repeats. Each iteration is a full inference call where the model decides what to do next. State accumulates with every iteration. Messages, tool calls, tool call results, observations, artifacts, etc.

If you think of an agent loop as a work cycle, this accumulated state is the work output. The longer the loop runs, the more value created.

## A new kind of data

At Electric, we started off building [Postgres Sync](/primitives/postgres-sync) for [state transfer in app development](/blog/2022/12/16/evolution-state-transfer). Then, as the type of software that teams were building on us evolved into AI apps and agentic systems, it became clear that [AI apps should be built on sync](/blog/2025/04/09/building-ai-apps-on-sync) too.

But it also became clear that syncing through Postgres wasn't going to cut it. We did the math: 50 tokens per second across a thousand concurrent sessions is 50,000 writes per second. Postgres maxes out around 20,000 writes per second. Factor in centralized latency and it doesn't add up.

Instead, we found ourselves wanting to write directly into the back of a [shape](/docs/guides/shapes). Shapes were already addressable, subscribable logs. What if we could strip out the database, avoid the centralized latency and let agents write directly into the log?

## Enter Durable&nbsp;Streams

[Durable Streams](https://durablestreams.com) are persistent, addressable, real-time streams. They are the data primitive we built specifically for the agent loop.

<figure style="margin: 24px 0">
  <img src="/img/blog/data-primitive-agent-loop/inline.jpg"
      alt="Visual connecting the agent loop to a data array"
  />
</figure>

### Persistent, addressable, real-time streams

A Durable Stream is a persistent, addressable, append-only log with its own URL. You can write directly to it, subscribe in real-time and replay from any position.

At the core, Durable Streams are extremely simple. They are append-only binary logs. Built on a generalization of the battle-tested [Electric sync protocol](/docs/api/http) that delivers billions of state changes daily.

The payload can be anything. The delivery protocol is standard HTTP. So it works everywhere, is cacheable and scalable through existing CDN infrastructure.

### Designed for the agent loop

Durable Streams are:

- **persistent** so agent sessions are durable and survive disconnects and restarts
- **addressable** so people, agents and systems can find them (every stream has a URL, every position an opaque monotonic offset)
- **reactive** so humans and agents can collaborate on the same session in real time
- **replayable** so you can join, audit or restart from any point
- **forkable** so users and agents can branch sessions to explore alternatives
- **lightweight** so they're trivial to spin up for every agent
- **low-latency** for single-digit ms latency at the CDN edge
- **extensible** with support for structured, multiplexed and multi-modal data

### Extensible layers and integrations

Beyond the core [open protocol](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md), Durable Streams is designed as a composable, layered stack on top of the core binary stream primitive. This allows them to be wired into and used from agentic systems easily and for the raw streams to support structured and multi-modal data.

The layers are growing all the time, for example including:

- [Durable State](https://durablestreams.com/durable-state) a protocol for syncing multiplexed, structured state
- [StreamDB](https://durablestreams.com/stream-db) a type-safe reactive database in a stream
- [StreamFS](https://durablestreams.com/stream-fs) a shared filesystem for agents in a stream

And integrations like:

- [TanStack&nbsp;AI](https://durablestreams.com/tanstack-ai) adding durable sessions support to TanStack AI apps
- [Vercel&nbsp;AI&nbsp;SDK](https://durablestreams.com/vercel-ai-sdk) durable transport adapter
- [Yjs](https://durablestreams.com/yjs) for realtime collaboration and CRDT support (with snapshot discovery, compaction, cursors and user status)

### Unlocking resilience and collaboration

Durable Streams unlock [resilient and collaborative agent sessions](/blog/2026/01/12/durable-sessions-for-collaborative-ai).

Users can disconnect, reconnect and resume without re-running expensive work. This unlocks real-time collaboration, where multiple users can work on the same session in real-time, and asynchronous collaboration, accessing and continuing sessions over time.

Agents can subscribe to and build on each other's work. Users and agents can spawn and fork sub-agents, teams, swarms and hierarchies of agents with durable state at every level. Agentic systems can record the full history of every agent action and plug this into existing audit and compliance systems.

Because Durable Streams use the [Electric delivery protocol](/docs/api/http), they support massive, elastic fan-out and concurrency through existing CDN infrastructure. Scale to zero or scale to [millions of concurrent real-time subscribers](/docs/reference/benchmarks#cloud).

## Data primitive for the agent loop

Agents are stateful. The agent loop accumulates state with every iteration. This state needs a new primitive. That's [Durable&nbsp;Streams](https://durablestreams.com).

> [!Warning] <img src="/img/icons/durable-streams.square.svg" style="height: 20px; margin-right: 6px; margin-top: -1px; display: inline; vertical-align: text-top" /> Try Durable&nbsp;Streams now
> See the [docs](https://durablestreams.com), [transports](/blog/2026/03/24/durable-transport-ai-sdks), [extensions](/blog/2026/03/26/stream-db), [examples](https://github.com/durable-streams/durable-streams/tree/main/examples) and [deploy&nbsp;now](https://dashboard.electric-sql.cloud/?intent=create&serviceType=streams) on [Electric&nbsp;Cloud](/cloud).
