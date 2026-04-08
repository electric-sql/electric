---
title: '...'
description: >-
  ...
excerpt: >-
  ...
authors: [balegas]
image: /img/blog/fork-branching-for-durable-streams/header.jpg
tags: [release, durable-streams, cloud, agentic, AI]
outline: [2, 3]
post: true
published: false
---

<!-- TLDR — what shipped and why it matters. No setup, no preamble. -->

[Durable Streams](/blog/2026/04/08/data-primitive-agent-loop) is the data
primitive for the agent loop. Today we're shipping fork — branching for
streams.

Fork creates a new stream from any point in an existing one. Instant,
single API call. Explore alternatives in parallel, go back and try a
different path, spin up scratch contexts.

Live on Electric Cloud today.

:::info
- [Protocol spec](https://github.com/durable-streams/durable-streams)
- [API docs](/docs)
- [Electric Cloud](/cloud)
:::

<!-- CONTEXT — brief orientation. Why branching matters, what's missing. -->

## Why branching

<!-- This section establishes the gap: branching is solved everywhere
     except agent conversation state. Keep it brisk — 4 bullets, not
     a backstory. -->

Durable Streams are persistent, addressable, real-time streams over
HTTP — the coordination layer for agent and multi-user apps.

Branching is becoming a core operation in agent workflows. LangGraph
built checkpoint-based forking. ChatGPT shipped branch conversations.
Academic work is formalizing conversation trees
([ContextBranch](https://arxiv.org/abs/2512.13914),
[CTA](https://arxiv.org/abs/2603.21278)).

Git solved branching for code. Neon and PlanetScale brought it to
databases. But agent conversation state is still hard — people hack
around it with manual snapshots and message list copies.

Fork adds branching to Durable Streams. A forked stream shares history
up to the fork point, then diverges independently.

<!-- WHAT'S SHIPPING — the mental model, API walkthrough, key properties. -->

## How fork works

<!-- Lead with the mental model, then walk through a concrete example
     with actual HTTP calls. Tone: factual, show don't tell. -->

Fork works like branching in git, but for streams. A fork shares history
with its source up to the fork point, then accumulates its own data
independently.

### Example: branching an AI chat

<!-- Walk through a concrete use case. Each step is a real HTTP call
     the reader can try. -->

Create a conversation stream and append messages:

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

{"role": "assistant", "content": "There are two approaches..."}
```

User wants to explore a different direction from the first message.
Fork with two headers:

```http
PUT /v1/stream/{service}/chat-123-branch-a
Stream-Forked-From: chat-123
Stream-Fork-Offset: {offset-after-first-message}
```

The fork is its own stream. Append different messages, read it —
clients see one continuous sequence (first message inherited from
source, then the fork's own data). No client changes needed.

Fork again from the same point for a second branch. Fork a fork for
deeper trees. Each fork is instant, independent, and has its own URL.

<!-- ASSET: diagram showing the conversation tree: source stream →
     fork at message 1 → two branches -->

### Key properties

- **Branch from any point** — one API call, two headers
- **Build trees** — fork a fork, any depth. Conversation trees,
  agent decision trees
- **Forks are independent** — no lifecycle coupling between source
  and forks

## Get started

<!-- Show don't tell. Code sample, links, get the reader moving. -->

Sign up for [Electric Cloud](/cloud) and create a service. Fork is
available now on all Durable Streams.

- [Protocol spec](https://github.com/durable-streams/durable-streams) —
  full fork semantics in the Durable Streams protocol
- [API docs](/docs) — reference for all stream operations
- [Electric Cloud](/cloud) — managed hosting for Durable Streams

## Coming next

<!-- Tease without overpromising. Invite ideas. -->

What would you build? Conversation trees, agent tournaments,
time-travel debugging, speculative branching at every decision
point — fork makes these one API call away.

***

## Next steps

- [Sign up for Electric Cloud](/cloud)
- [Read the docs](/docs)
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
        href="/docs"
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

<!--
  ============================================================
  DELETE EVERYTHING BELOW THIS LINE BEFORE PUBLISHING
  ============================================================

  ## Intent

  - **What is this post about?** Durable Streams now supports fork —
    branching for streams, live on Electric Cloud.
  - **What's interesting?** Agents need branching: explore alternatives,
    go back and try a different path, scratch contexts. Fork makes this
    instant and built into the primitive.
  - **Reader takeaway:** Fork is available on Electric Cloud now. You
    can add branching to any stream-backed app with one API call.
  - **CTAs:** Sign up for Electric Cloud, read docs (protocol spec,
    API), try the demo.
  - **Authority:** We built Durable Streams and designed fork into the
    protocol. First-party release announcement.

  ## Title brief

  Sentence case. Should convey "fork is shipping on Electric Cloud"
  without being generic. Directions:
  - "Fork: branching for durable streams"
  - "Durable streams now fork"
  - "Shipping fork on Electric Cloud"

  ## Description brief (SEO)

  Mention fork, durable streams, branching, agent workflows. Convey
  that this is a new feature release on Electric Cloud.

  ## Excerpt brief (blog listing card)

  2-3 short sentences. Fork adds branching to Durable Streams — branch
  from any point, instant, single API call. Live on Electric Cloud.

  ## Image prompt

  - Concept: branching/forking streams — a single stream splitting
    into multiple paths
  - Dark theme background
  - Brand colors: #D0BCFF (purple), #00d2a0 (green), #75fbfd (cyan)
  - 16:9, ~1536x950px, center-center composition
  - Use /blog-image-brief for a detailed prompt

  ## Asset checklist

  - [ ] Header image (use /blog-image-brief)
  - [ ] Diagram: conversation tree showing source stream forking
        into branches
  - [ ] Demo video: AI chat with fork buttons (when demo is ready)
  - [ ] Demo link: add to info box when ready

  ## Typesetting checklist

  - [ ] Non-breaking spaces where appropriate to avoid widows/orphans
  - [ ] Title uses sentence case
  - [ ] Check title, image, and post at different screen widths
  - [ ] No LLM tells: "it's worth noting", "importantly",
        "in conclusion", "let's dive in", "at its core"

  ## Open questions

  - Demo: link to be added when companion demo is ready
  - Social proof: any community reactions or early users to quote?
  - Coming next: confirm this is the right tease
  - Doc links: confirm correct paths for protocol spec and API docs
-->
