---
title: 'Fork — branching for Durable Streams'
description: >-
  Fork is branching for Durable Streams. Branch any stream at any point with a single API call. Rewind history, fan out agents in parallel, or probe without polluting context. Live on Electric Cloud.
excerpt: >-
  Fork adds branching to Durable Streams. Branch any stream at any point — rewind history, fan out agents, or probe without polluting context.
authors: [balegas]
image: /img/blog/fork-branching-for-durable-streams/header.jpg
tags: [release, durable-streams, cloud, agentic, AI]
outline: [2, 3]
post: true
published: true
---

[Durable Streams](/primitives/durable-streams) is the [data primitive for the agent loop](/blog/2026/04/08/data-primitive-agent-loop). Today we're shipping fork — a single API call that branches a stream at any point. Rewind history, fan out agents in parallel, or probe an agent without polluting its context.

A fork creates a new stream from any point in an existing one. It shares everything before the fork point with its source and evolves independently after it. One API call, two headers.

## Streams are sessions

Agent infrastructure is converging on a pattern: the session — the complete log of messages, tool calls, and decisions — lives in a durable stream that lives outside the agent itself. Anthropic's recent post on [Managed Agents](https://www.anthropic.com/engineering/managed-agents) describes exactly this architecture: an append-only session log that the harness writes to, reads from, and resumes after a crash. Durable Streams provide exactly this primitive.

A session log is linear but agent workflows aren't. An agent goes down a path that isn't working and you want to rewind a few turns. Multiple agents need to fan out from the same starting point. You want to ask an agent a question without putting it in its history. These all require the same operation that a linear log doesn't have: the ability to take the session at any point and diverge.

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
Stream-Forked-From: /v1/stream/{service}/chat-123
Stream-Fork-Offset: 2
```

`chat-123-containers` now exists with the first two messages as shared history. Anything appended from here is independent. Fork again from the same offset for a second branch:

```http
PUT /v1/stream/{service}/chat-123-vms
Stream-Forked-From: /v1/stream/{service}/chat-123
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

We built a demo that shows this: a chat application where users can fork any point in a conversation and explore a different direction. [Try the fork demo](https://fork-ai-chat.examples.electric-sql.com).

<div class="embed-container" style="padding-bottom: 84.4%">
  <YoutubeEmbed video-id="gmkqygh9ezo" />
</div>

### Parallel paths

Conversation trees branch sequentially — a user or agent tries one direction, then goes back and tries another. Parallel paths are different: multiple agents fork from the same point and run simultaneously.

Fork the session once per agent. Each gets its own branch while the shared history exists once at the storage level. A fleet of agents can fan out from the same session to tackle a problem from different angles. A lead agent can fork when the current approach isn't working and hand the branch to a specialist. Each branch is fully isolated, but the common context is shared. Compare the results and pick the best path.

<figure>
  <img src="/img/blog/fork-branching-for-durable-streams/fork-parallel-paths-diagram.svg" alt="Parallel paths: a shared session forks into three agents, each pursuing a different strategy independently" />
</figure>

### Scratch contexts

Sometimes you need to interrogate an agent without changing its state. A developer debugging a misbehaving agent wants to ask "what do you think the user wants?" without that meta-question influencing the next real turn. A harness wants to test whether the agent can answer a factual question before committing to a tool call.

Fork the session, run the side conversation in the fork, read the result. The main session is untouched — no phantom turns in the history, no context pollution. If the answer is useful, the harness can bring it forward explicitly. If not, the fork is just abandoned.


## Getting started

Fork is available now on all Durable Streams services on [Electric Cloud](/cloud). Sign up, create a stream service, and start using it.

The [protocol spec](https://github.com/durable-streams/durable-streams) covers the full fork semantics — offset behavior across forks, concurrent readers, deletion propagation. The [API docs](/docs/intro) have the reference for all stream operations including fork.

***

- [Sign up for Electric Cloud](/cloud)
- [Try the fork demo](https://fork-ai-chat.examples.electric-sql.com)
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
