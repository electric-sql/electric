---
title: 'Fork: branching for durable streams'
description: >-
  Durable Streams is the session primitive for agent infrastructure. Fork adds branching — go back to any point, explore parallel paths, compact without losing history. Live on Electric Cloud.
excerpt: >-
  Agent sessions need branching. Fork adds it to Durable Streams — branch from any point, fan out across agents, compact aggressively without losing history. One API call, live on Electric Cloud.
authors: [balegas]
image: /img/blog/fork-branching-for-durable-streams/header.jpg
tags: [release, durable-streams, cloud, agentic, AI]
outline: [2, 3]
post: true
published: false
---

Durable Streams is the session primitive for agent and multi-user applications. We're extending it with fork: go back to any point in a session and try a different path, fan out across multiple agents from shared context, or compact aggressively without losing history.

A fork creates a new stream from any point in an existing one. It shares everything before the fork point with its source and evolves independently after it. One API call, two headers.

## Streams are sessions

Agent infrastructure is converging on a pattern: the session — the complete log of messages, tool calls, and decisions — lives in an a durable object that lives outside the agent itself. Anthropic's recent post on [Managed Agents](https://www.anthropic.com/engineering/managed-agents) describes exactly this architecture: an append-only session log that the harness writes to, reads from, and resumes after a crash. Durable Streams provide exactly this primitive.

A session log is linear but agent workflows aren't. An agent goes down a path that isn't working and wants to rewind a few turns. You want to preserve the full uncompacted history while compressing the working context. Multiple agents need to fan out from the same starting point. These all require the same operation that a linear log doesn't have: the ability to take the session at any point and diverge.

## Fork: branching for streams

A [Durable Stream](/primitives/durable-streams) assigns an offset to each message as it's appended. When you fork a stream, you specify a source stream and a fork offset. The system creates a new stream that inherits all messages from the source up to that offset. After the fork point, the new stream lives independently — its own URL, its own appends, its own subscribers.

Forks don't copy data. The shared history between a fork and its source is genuinely shared at the storage level. This means forking is instant regardless of stream length — a stream with ten thousand messages forks just as quickly as one with three.

Because forks are themselves regular Durable Streams, they can be forked. This gives you trees of arbitrary depth where every node is an addressable stream with the full set of stream operations available.

### The API

Create a conversation stream and append some messages:

```http
PUT /v1/stream/{service}/chat-123
```

```http
POST /v1/stream/{service}/chat-123
Content-Type: application/json

{"role": "user", "content": "How do I deploy to prod?"}
```

```http
POST /v1/stream/{service}/chat-123
Content-Type: application/json

{"role": "assistant", "content": "Two main options: containerized with Fly or Railway, or a VM setup on EC2. The tradeoffs are..."}
```

Fork from offset 2 — right after the assistant's first response:

```http
PUT /v1/stream/{service}/chat-123-containers
Stream-Forked-From: chat-123
Stream-Fork-Offset: 2
```

`chat-123-containers` now exists with the first two messages as shared history. Anything appended from here is independent. Fork again from the same offset for a second branch:

```http
PUT /v1/stream/{service}/chat-123-vms
Stream-Forked-From: chat-123
Stream-Fork-Offset: 2
```

Clients reading any branch see a single continuous sequence — the shared prefix followed by branch-specific messages — without any special handling.

### Properties

- **Instant** — metadata operation, not a data copy. Cost doesn't scale with stream length.
- **Independent** — no lifecycle coupling between source and forks. Delete or append to one without affecting the other.
- **Transparent** — readers see one continuous sequence. The fork boundary is invisible unless you inspect stream metadata.
- **Composable** — fork a fork for trees of any depth.
- **Plain HTTP** — same protocol, same SSE, same offset-based reads. Two new headers on the PUT.

## What fork enables

### Conversation trees

ChatGPT shipped branch conversations as a user-facing feature. LangGraph added checkpoint-based forking to their agent framework. The pattern keeps showing up because agent conversations aren't linear — users want to go back, try a different direction, compare alternatives.

With Durable Streams, a conversation tree is a set of streams related by forks. The root is the original conversation. Each branch point is a fork. Every node is a regular stream with the full set of stream operations — reads, writes, real-time subscriptions. Branching lives at the data layer, not inside a specific framework's checkpoint system, so any client that can read a Durable Stream can work with forked streams without modification.

We built a demo that shows this: a chat application where users can fork any point in a conversation and explore a different direction.

> [Demo link TBD] | [Source code link TBD]

### Parallel paths

Conversation trees branch sequentially — a user or agent tries one direction, then goes back and tries another. Parallel paths are different: multiple agents fork from the same point and run simultaneously.

Fork the session once per agent. Each gets its own branch while the shared history exists once at the storage level. A fleet of agents can fan out from the same session to tackle a problem from different angles. A lead agent can fork when the current approach isn't working and hand the branch to a specialist. Each branch is fully isolated, but the common context is shared. Compare the results and pick the best path.

<figure>
  <img src="/img/blog/fork-branching-for-durable-streams/fork-parallel-paths-diagram.svg" alt="Parallel paths: a shared session forks into three agents, each pursuing a different strategy independently" />
</figure>

Fork also enables speculative work. An agent can branch into a scratch context to test a hypothesis or try a risky tool call without affecting the main session. If the result is useful, summarize it back. If not, the branch is just left behind — still there for debugging or audit, but with no effect on the source.

### Non-destructive compaction

As an agent works over many turns, its context window fills up. The standard approaches — compaction, trimming, memory tools — all involve irreversible decisions about what to keep and what to discard. And it's hard to predict which tokens future turns will need.

Fork makes context management non-destructive. Before compacting, fork the session. The fork preserves the full, uncompacted history. The original stream continues with the compressed context. If the compaction lost something important — a constraint mentioned twenty turns ago, an architectural decision that matters again — the full history is still there on the fork. The harness can read back into it, find what it needs, and bring that context forward.

This lets you be aggressive about compaction in a way that's hard to justify when the decision is permanent. Compress hard, move fast, and know that nothing is actually lost.

<figure>
  <img src="/img/blog/fork-branching-for-durable-streams/fork-compaction-diagram.svg" alt="Non-destructive compaction: fork preserves full history while the main stream continues with compressed context" />
</figure>

## Getting started

Fork is available now on all Durable Streams services on [Electric Cloud](/cloud). Sign up, create a stream service, and start using it.

The [protocol spec](https://github.com/durable-streams/durable-streams) covers the full fork semantics — offset behavior across forks, concurrent readers, deletion propagation. The [API docs](/docs/intro) have the reference for all stream operations including fork.

***

- [Sign up for Electric Cloud](/cloud)
- [Read the docs](/docs/intro)
- [Join the Discord](https://discord.electric-sql.com)

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
        href="/cloud/sign-up"
        text="Sign up"
        theme="brand"
    />
    &nbsp;
    <VPButton
        href="/docs/intro"
        text="Docs"
        theme="alt"
    />
    &nbsp;
    <VPButton
        href="https://discord.electric-sql.com"
        text="Discord"
        theme="alt"
    />
  </div>
</div>
