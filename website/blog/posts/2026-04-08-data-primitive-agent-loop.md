---
title: "Durable\u00A0Streams \u2014 the data primitive for the\u00A0agent\u00A0loop"
description: >-
  Agents are stateful. The agent loop accumulates a new kind of data that needs a new kind of primitive. Durable Streams is that primitive.
excerpt: >-
  Agents are stateful. The agent loop accumulates a new kind of data that needs a new kind of primitive. Durable Streams is that primitive.
authors: [thruflo]
image: /img/blog/data-primitive-agent-loop/header4.jpg
tags: [durable-streams, agents, sync]
outline: [2, 3]
post: true
published: true
---

<script setup>
import AgentLoopAnimation from '../../src/components/blog/data-primitive-agent-loop/AgentLoopAnimation.vue'
</script>

Agents are stateful. The agent loop accumulates state: messages, token streams, tool calls, results. A new kind of data that existing infra wasn't designed for.

[Durable&nbsp;Streams](https://durablestreams.com) are persistent, addressable, real-time streams. Reactive, subscribable, replayable, forkable and extensible, they are the data primitive for the agent&nbsp;loop.

> [!Warning] <img src="/img/icons/durable-streams.square.svg" style="height: 20px; margin-right: 6px; margin-top: -1px; display: inline; vertical-align: text-top" /> Dive into Durable&nbsp;Streams
> See the [docs](https://durablestreams.com), [transports](/blog/2026/03/24/durable-transport-ai-sdks), [extensions](/blog/2026/03/26/stream-db), [examples](https://github.com/durable-streams/durable-streams/tree/main/examples) and [deploy&nbsp;now](https://dashboard.electric-sql.cloud/?intent=create&serviceType=streams) on [Electric&nbsp;Cloud](/cloud).

## The agent loop

Agents are being deployed at massive and accelerating scale. The core execution pattern behind them is the agent loop: a cycle of observe → think → act → repeat.

The agent receives a task, reasons about what to do, decides on an action, executes it and then feeds the result back into its own context as a new observation.

<ClientOnly>
  <AgentLoopAnimation />
</ClientOnly>

This loop repeats. Each iteration is a full inference call where the model decides what to do next. State accumulates with every iteration. Messages, tool calls, tool call results, observations, artifacts, etc. If you think of an agent loop as a work cycle, this accumulated state is the work output.

The longer the loop runs, the more work gets done. The more the loop runs autonomously, the more value there is per human intervention.

### A new kind of data

The state accumulated by the loop is a genuinely new kind of data. It didn't exist when today's storage and database systems were invented. In fact, as an industry, we're still figuring out what it is and how to deal with it.

At Electric, we started off building sync infrastructure for [state transfer in app development](/blog/2022/12/16/evolution-state-transfer). Then, as we developed, the type of software that teams were building on us evolved. From SaaS platforms building the next Figma or Linear, to AI apps and agentic systems like [HumanLayer](https://www.humanlayer.dev), [Sazabi](https://www.sazabi.com) and [Superset](https://superset.sh/).

It became very clear that [AI apps should be built on sync](/blog/2025/04/09/building-ai-apps-on-sync). But it also became clear that they needed a different kind of sync infrastructure.

Teams were building AI chat apps on our [Postgres Sync](/primitives/postgres-sync) service. Apps were suddenly streaming tokens from active LLM generations into the client and needed [resilient, exactly once message delivery](/blog/2026/03/24/durable-transport-ai-sdks#resilience-and-collaboration).

### A new sync protocol

We did the math: 50 tokens per second across a thousand concurrent sessions is 50,000 writes per second. Postgres maxes out around 20,000 writes per second. Factor in centralized latency and it doesn't add up.

Even when we'd made databases and object storage reactive and synced-up, they weren't what AI apps and agents needed.

Instead, we found ourselves wanting to write directly into the back of a [shape](/docs/guides/shapes). Shapes were already addressable, subscribable logs. What if we could strip out the database, avoid the centralized latency and let agents write directly into the log?

So we generalized our database sync protocol into [Durable&nbsp;Streams](/primitives/durable-streams). The same resilient, exactly-once message delivery, without the central database and with radically higher throughput (millions of writes per second).

This post shares what we learned about the unique demands of agent state and exactly what we built to meet it.

## The demands of agent state

Agent state is something that humans, agents and organisations all need to use.

### Humans

Humans need to drive and collaborate on sessions.

In real-time, with potentially multiple users and agents working on the same session at the same time. And asynchronously, so your colleague can picks up where you left off and your boss can review your work tomorrow.

Sessions also need to support all types of data. They're often chat but also structured and multi-modal data, like tool calls, images and videos. Anything you can imagine on the web.

### Agents

Increasingly, agents are the ones spawning other agents.

Child agents need to inherit context from and report to their parents. Parents (and monitor agents) need to see and potentially respond to what the children and other agents are doing.

Agents also need to fork and branch sessions, replay them from any position and restart from a checkpoint. Agents are also highly sensitive to context size, so they especially need to compress and summarize data and use patterns like [observational memory](https://mastra.ai/docs/memory/observational-memory) across sessions.

### Organizations

When agent sessions are how work gets done, they inherit the governance requirements of the work itself. What happened in this session? Who decided what and why?

The state must wire into the same collaboration, reporting, access control and compliance systems that the organization already runs on.

### Distlling the requirements

As a result we can see that a data primitive for agent state needs to be:

1. **persistent** so it survives disconnects, restarts, crashes
1. **addressable** so other people, agents and systems can find them
1. **reactive** so they're subscribable and support real-time collaboration
1. **replayable** so they can be joined and consumed from any point
1. **forkable** so they can be branched (and ideally also merged!)
1. **lightweight** so they can be spun up easily by agents for other agents
1. **low-latency** so there's no round-trip to a centralized service
1. **directly writable** so agents can write to the stream as they execute
1. **structured** with support for wrapper protocols and typed data
1. **multi-modal** so they can handle any type of data
1. **multiplexed** through the same session

## Existing options

If we compare these requirements with existing data infrastructure options, we can see that none of them are exactly the right thing.

### Ad-hoc and single-machine solutions

Agentic systems are being built right now with a whole host of ad-hoc solutions to state management. Everything from just throwing it away to filling up local machines with markdown files in hidden folders, to stuffing it all into the database.

Most agentic systems today are still running in single-machine harnesses. We all figured out that LLMs could speak bash and it's been tool calls ever since. Unreasonably effective but extremely hard for other users to access.

The OS-level primitives that work on a single machine (files, signals, process watching) need to be replaced by networked equivalents as agents move online.

### Databases

As we've seen, databases are generally too heavy and centralized for this use case. OLTP systems are generally designed for structured queries and transactions, not append-only streaming with real-time subscriptions.

You rarely want to run an AI token stream through your main Postgres. The latency and overhead of a centralized database doesn't match the co-located, low-latency demands of agent state.

### Object storage

Object storage can be lighter and more co-located. It can provide the key underlying durability for sessions. However, object storage isn't typically reactive or subscribable and tends to just support binary, rather than structured, multi-modal data.

### Redis

Redis (and similar systems) are closer. And have been used in many agentic systems, for example backing Vercel's [`resumeable-stream`](https://github.com/vercel/resumable-stream) transport.

Redis can be low-latency and provides native pub/sub capabilities. However it is typically still centralized and is a generalized data structure server. It's not fully agent-specific. Schema support has to be built on top. Message delivery is not guaranteed and replay and forking semantics need to built on top.

### S2

[S2 streams](https://s2.dev) are persistent, subscribable, binary streams. One of the closest primitives to core Durable Streams, they specifically target [agentic use-cases](https://s2.dev/docs/use-cases/agents). However they don't build in support for some of the [higher-level ergonomics](#extensible-layers-and-integrations) we're after, like wrapper protocols, structured sessions and multi-modal data.

## Enter Durable&nbsp;Streams

[Durable Streams](https://durablestreams.com) are a data primitive designed specifically to meet the demands of state management for the agent loop.

### Persistent, addressable, real-time streams

A Durable Stream is a persistent, addressable, append-only log with its own URL. You can write directly to it, subscribe in real-time and replay from any position.

At the core, Durable Streams are extremely simple. They are append-only binary logs. Built on a generalization of the battle-tested [Electric sync protocol](/docs/api/http) that delivers billions of state changes daily.

The payload can be anything. The delivery protocol is standard HTTP. So it works everywhere, is cacheable and scalable through existing CDN infrastructure.

### Designed for the agent loop

Durable Streams are designed to meet all of the demands of state management for the agent loop:

1. **persistent** streams have their own durable storage
1. **addressable** every stream has a URL, every position has an opaque
  monotonic offset
1. **reactive** designed for real-time tailing so clients can subscribe and get updates as they're written
1. **replayable** read from any offset, catch up from any point
1. **forkable** fork from any offset
1. **lightweight** trivial to spin up
1. **low-latency** co-locatable with agents, designed for single-digit ms latency at the CDN edge
1. **directly writable** agents can write to the stream as they execute
1. **structured**, **multi-modal**, **multiplexed** wrapper protocols like [StreamDB](https://durablestreams.com/stream-db) layer typed schemas on top of the binary stream using [Standard Schema](https://standardschema.dev) for end-to-end type safety and multiplexed multi-modal data

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

Durable Streams unlock resilient and collaborative agent sessions.

Users can disconnect, reconnect and resume without re-running expensive work. This unlocks real-time collaboration, where multiple users can work on the same session in real-time, and asynchronous collaboration, accessing and continuing sessions over time.

Agents can subscribe to and build on each others' work. Users and agents can spawn and fork sub-agents, teams, swarms and hierarchies of agents with durable state at every level. Agentic systems can record the full history of every agent action and plug this into existing audit and compliance systems.

Because Durable Streams use the Electric delivery protocol, they support massive, elastic fan-out and concurrency through existing CDN infrastructure. Scale to zero or scale to [millions of concurrent real-time subscribers](/docs/reference/benchmarks#cloud).

## Data primitive for the agent loop

Agents are stateful. The agent loop accumulates state with every iteration. The more the loop runs, the more automation, the more business value.

This state needs a new primitive. One that's native-to and designed-for the unique requirements of the agent loop.

That's [Durable&nbsp;Streams](https://durablestreams.com).

> [!Warning] <img src="/img/icons/durable-streams.square.svg" style="height: 20px; margin-right: 6px; margin-top: -1px; display: inline; vertical-align: text-top" /> Try it in action now
> See the [docs](https://durablestreams.com), [transports](/blog/2026/03/24/durable-transport-ai-sdks), [extensions](/blog/2026/03/26/stream-db), [examples](https://github.com/durable-streams/durable-streams/tree/main/examples) and [deploy&nbsp;now](https://dashboard.electric-sql.cloud/?intent=create&serviceType=streams) on [Electric&nbsp;Cloud](/cloud).
