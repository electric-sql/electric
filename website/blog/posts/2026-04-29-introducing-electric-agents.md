---
title: "Introducing Electric Agents — the agent platfom built\u00A0on\u00A0sync"
description: >-
  Introducing Electric Agents, the agent platform built on sync. Use it to build scalable, collaborative multi-agent systems that integrate into your online systems.
excerpt: >-
  Introducing Electric Agents, the agent platform built on sync. Use it to build scalable, collaborative multi-agent systems that integrate into your online systems.
authors: [kyle]
image: /img/blog/introducing-electric-agents/header3.jpg
tags: [electric-agents, durable-streams, agents, sync, collaboration]
outline: [2, 3]
post: true
homepageSolution: true
homepageOrder: 10
published: true
---

<script setup>
  import AgentLoopFillDemo from "../../src/components/streams-home/AgentLoopFillDemo.vue"
  import HomeCompositionHero from "../../src/components/home/HomeCompositionHero.vue"
  import YoutubeEmbed from '../../src/components/YoutubeEmbed.vue'
</script>

Agents are long-lived, logical entities that live in the data layer. Collaborative, multi-agent systems are a distributed data problem. The substrate for that is a sync engine.

Today we're introducing [Electric Agents](/agents/): the first agent platform built on sync.

Use it to build scalable, multi-agent systems, enable rich multi-user, multi-agent collaboration and integrate agents into your online systems.

> [!Warning] ✨&nbsp; Get started with Electric Agents
> See the [Overview](/agents/), [Docs](/docs/agents/) and [Quickstart](/docs/agents/quickstart) guide.

<div class="embed-container">
  <YoutubeEmbed video-id="x84uGuLWJNA" title="Electric - Agents on sync" />
</div>

## Guarding the log

Why can't I pick up my Claude Code session on my phone?

You start an agent. It runs for ten minutes. You close your laptop to go to a meeting. You can't check on it from your phone. You can't share the live session with a colleague. You can't point a supervisor agent at it. You can't fork it and try a different approach without losing the original.

These feel like missing features, but they're all symptoms of the same thing. The agent's state isn't *live* and *online*. It's dumped into a hidden file on your computer somewhere. Or if the agent is online, like in a Durable Object, access is guarded by the interface it's exposed behind.

The agent session, the session log, is not accessible. You can't share it, you can't observe it or subscribe to it. You can't fork it. It's not *addressable*. These aren't seperate problems. They're all the same problem. Agents are treated as compute and access to the session log is prohibited or guarded by predefined interfaces.

### Inverting the paradigm

What if instead of hiding or guarding access to the log, you turn the agent inside out and just expose the log, on the outside? In a [data primitive like a Durable Stream](/blog/2026/04/08/data-primitive-agent-loop).

Suddenly, all your agents become:

- **persistent** &mdash; sessions survive crashes and disconnects
- **addressable** &mdash; every agent has an address you can communicate with
- **observable** &mdash; monitor agents from anywhere
- **resumable** &mdash; connect to and resume sessions from any point
- **shareable** &mdash; share sessions with users, devices and other agents
- **composable** &mdash; agents can build on each other's work
- **forkable** &mdash; for concurrency and exploration

It's a totally different paradigm.

<figure style="border: 0.5px solid #75FBFD">
  <a href="/img/blog/introducing-electric-agents/one-primitive.jpg" class="no-visual">
    <img src="/img/blog/introducing-electric-agents/one-primitive.jpg" />
  </a>
</figure>

## Moving to multi-agent

The world is moving to online multi-agent systems:

It's why Anthropic have built [Managed Agents](https://www.anthropic.com/engineering/managed-agents). It's the [vision of the Context Graph](https://foundationcapital.com/ideas/context-graphs-ais-trillion-dollar-opportunity). It's the direction of [Cloudflare's Project Think](https://blog.cloudflare.com/project-think/):

> We see three waves of AI agents:
>
> - **The first wave was chatbots**.
> - **The second wave was coding agents**.
> - **Now we are entering the third wave: agents as infrastructure**.
>
> Durable, distributed, structurally safe, and serverless. These are agents that run on the Internet, survive failures, cost nothing when idle, and enforce security through architecture rather than behavior. Agents that any developer can build and deploy for any number of users.

Agents running locally and/or bolted onto apps are early wave transitional states. We've rushed to make things work. Now we're starting to make them right.

The end state is every organization running millions of persistent, addressable, online agents reacting to their environment. Agents will be the basis of all software. With apps and systems built around them, not the other way around.

That's a different kind of infrastructure problem. It means envisaging a very different kind of substrate for agents. One that's addresible, reactive and multi-agent by default.

### Multi-player by default

The moment you put agent state in Postgres, Redis, SQLite, or a file, you've chosen a substrate that's not multi-player by default.

Every team building on them reinvents piecemeal sync. Websockets, SSE, ad-hoc interprocess communication. Using the filesystem for local agents and some sort of custom pub/sub layer for coordination.

### A new kind of infrastructure

Agent state needs to be syncable and live. So multiple readers can observe and subscribe to the state in real time and every participant (user, agent, supervisor, UI, other agents) can have both live and async access to the same state.

Agent state also needs to be cheap and scalable enough for per-agent granularity. One stream per agent, per session, per user, without your infra bill exploding.

## Turning the agent inside out

A decade ago, Martin Kleppmann gave a talk called [Turning the Database Inside-Out](https://martin.kleppmann.com/2015/03/04/turning-the-database-inside-out.html). He didn't propose a new product. He proposed a new way of seeing the same reality.

Databases had always been treated as monolithic, mysterious things. He pointed at the commit log and said: that's the database. Everything else — indexes, caches, materialized views — is a projection over the log.

Agents are in the same black-box moment. Current agent frameworks are complicated because they reach for primitives that weren't designed for the problem — request handlers, workflow runners, actors, memory frameworks — and glue them together with custom infrastructure. But agents aren't complicated. Once you see the substrate clearly, the whole thing simplifies.

Kleppmann's insight: the database is a log with projections on top. Agents need the same architecture with one extension — the log has to be live. Not just durable and ordered, but multi-reader, multi-writer, reactive, and real-time. A [Durable Stream](/streams/).

<figure>
  <AgentLoopFillDemo />
</figure>

### The agent is the durable stream

With [Electric Agents](/agents/) we propose a new way of seeing agents:

> **The agent is the durable stream.**
>
> Everything else is a projection or a subscriber.

The stream isn't just where the agent's data lives. It's the agent's identity. It's where the agent lives. Swap models or tools mid-session and the agent persists. The history, the context, the fork tree — all in the stream. The model is just the current subscriber doing the thinking.

<!-- ASSET: "The agent is a durable stream" flow diagram — Variant 3: Writers → Durable Stream → Subscribers → Projections. Production version in brand colors on dark background. 1536x950px or similar. -->

When you see agents like this, everything changes:

- **spawning** means creating a new stream
- **communication** means writing to each other's streams
- **coordination** means monitoring the stream
- **request-response** means write-to and monitor
- **memory** is a compressed projection over the stream
- **context** is a filtered projection over the stream
- **transcripts, audit logs, decision traces** all projections
- **workflows, fork trees** all projections too (durable execution is what you get when you replay the projection to recover.

Compute is just what one of the subscribers happens to be doing. The LLM loop, tool calls, these all become execution that's downstream of a stream subscriber. RPC between agents, human-in-the-loop, Slack/email/SMS notifications — all one primitive. The responder is a parameter, not a protocol.

Consider what happens to human-in-the-loop under this model.

Today, building an agent that asks a user a question and routes to Slack if they're busy, or email if they're offline requires multiple integrations and custom glue code. Under the stream model, it's one pattern: the agent writes a request to the user's inbox.

The user is an entity with subscribers — the app, Slack, email — and whichever subscriber picks it up handles the rendering. The agent doesn't know the difference between "Alice replied in the app" and "Alice replied via email." It just saw a write to its stream and resumed. Agents, users, and channels are all addressable entities with inboxes. The entity abstraction collapses notifications, HITL, and RPC into one primitive.

The full picture is three layers:

1. [Durable Streams](/blog/2026/04/08/data-primitive-agent-loop) at the base
2. collaborative state (like [StreamDB](/docs/streams/stream-db) and [StreamFS](/docs/streams/stream-fs)) built on top
3. reactive queries ([TanStack DB](/sync/tanstack-db)) for UIs and agent context

Each layer is a view of the one below it. The code stays small because the concept stays singular.

<style>
  .layers-illustration-wrapper {
    position: relative;
    width: 100%;
    aspect-ratio: 5.6 / 4;
    margin-bottom: -10px;
  }

  @media (max-width: 860px) {
    .layers-illustration-wrapper {
      aspect-ratio: 7 / 4;
    }
  }
</style>

<figure>
  <div class="layers-illustration-wrapper">
    <HomeCompositionHero />
  </div>
</figure>

## Examples

Let's see what this looks like in practice.

### Shared sessions

<!-- Demo 1: Multiple readers on the same session, falling out of the architecture for free. -->

Invite a colleague to a running agent. They join with their own identity, see the live state, interact in real time. Multiple readers on the same session — not a collaboration feature you built, but what sync does by default.

<!-- ASSET: Shareable sessions demo — recording or screenshot -->
<!-- ASSET: Code snippet — minimal code to share a session -->

### Agent swarms

<!-- Demo 4: Multi-agent coordination emerging from the data layer, no centralized orchestrator. -->

Point a swarm at a codebase. Ten agents fan out — each takes a subsystem, reads the code, writes documentation. They converge through the shared sync layer: each writes its findings to a shared stream, the others read and cross-reference, a synthesis agent subscribes to all of them and produces a coherent wiki. No centralized orchestrator, no hand-wired message routing — just agents subscribing to what they need and producing what others consume.

Every other multi-agent framework needs a coordinator because state lives in each agent's process. When state lives in a shared stream, the stream is the coordinator.

<!-- ASSET: Agent swarm demo — recording or screenshot -->
<!-- ASSET: Code snippet — swarm setup, minimal orchestration code -->

### Supervisors

<!-- Demo 2: Governance as message passing between addressable actors — no orchestration framework. -->

Spawn an agent with judgment criteria. The supervisor subscribes to the main agent's stream, evaluates each output against the criteria, and sends pass/fail messages back. Governance as message passing between addressable actors — no orchestration framework, just agents talking to agents through durable streams.

<!-- ASSET: Supervisor demo — recording or screenshot -->
<!-- ASSET: Code snippet — supervisor setup, show how little code -->

### Forking

<!-- Demo 3: Version control for agent execution. Concrete, distinctive. Something linear session models don't foreground. -->

The agent goes off the rails at step 7. Fork the stream at step 6. The fork inherits the full prefix — all prior context preserved. Continue from the fork with a different approach. Version control for agent execution, falling out of the log-centric architecture naturally.

<!-- ASSET: Fork demo — recording or screenshot showing the branch point -->
<!-- ASSET: Code snippet — fork operation -->

## Managed agents

The shape of the argument above isn't controversial inside the companies building agent infrastructure. In the last few weeks alone:

- **Anthropic**, [introducing Managed Agents](https://www.anthropic.com/engineering/managed-agents), described the session as "the append-only log of everything that happened" — and built the runtime around the claim that the harness shouldn't hold state: *"Because the session log sits outside the harness, nothing in the harness needs to survive a crash. When one fails, a new one can be rebooted with `wake(sessionId)`, use `getSession(id)` to get back the event log, and resume from the last event."*
- **Cloudflare**, [introducing Project Think](https://blog.cloudflare.com/project-think/), described three waves of agents: chatbots (stateless, reactive), coding agents (stateful, tool-using), and agents as infrastructure — *"Durable, distributed, structurally safe, and serverless. These are agents that run on the Internet, survive failures, cost nothing when idle."* They correctly identified that agents are not request-handlers and require their own execution environment.
- **LangChain**, via Harrison Chase, [landed on the lock-in](https://www.langchain.com/blog/your-harness-your-memory): *"As soon as there is any state associated, its much harder to switch. Because this memory matters. And if you switch, you lose access to it."* State ownership determines everything downstream. Harness portability is memory portability.

Each of them independently arrived at a piece of the same architectural picture. Append-only log as the source of truth. Session that outlives the process. State that outlives the model. One-to-one addressability. They agree on almost everything except what the substrate underneath should be.

### Without the lock-in

Electric Agents is an open implementation of these patterns based on composable sync primitives. It makes no assumptions about which models you choose or where you run your compute. It's brownfield compatible with existing web systems, APIs and cloud native compute infrastructure.

The [code is fully open source](#) and comes with a conformance suite and a reference implementation in TypeScript for the server and runtime. The [protocol is open](#). Implementations in other languages are welcome and encouraged.

You can host the data primitivs yourself, or use [Electric Cloud](/cloud/). We'll be offering a managed agent runtime service soon. But you will also always be able to run your own, on your own infrastructure, on your own terms.

Open source. Your model, your infrastructure. [Durable Streams](/streams/) under the hood.

## Next steps

You can use [Electric Agents](/agents/) today. See [how the system works](/agents/), read the [documentation](/docs/agents/) and jump in to follow the [Quickstart](/docs/agents/quickstart) to wire in your first agent today:

```bash
npx electric-ax agents quickstart
```

And follow the instructions! If you need support or have any questions, join our [community Discord](https://discord.electric-sql.com) and say hello there.

***

Agents are long-lived, logical entities that live in the data layer. Collaborative, multi-agent systems are a distributed data problem. The substrate for that is a sync engine.

[Electric Agents](/agents/) is the first agent platform built on sync. Use it to build scalable, multi-agent systems, enable rich multi-user, multi-agent collaboration and integrate agents into your online systems.