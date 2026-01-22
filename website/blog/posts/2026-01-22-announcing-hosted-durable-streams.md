---
title: 'Announcing Hosted Durable Streams'
description: >-
  Hosted durable streams is now live on Electric Cloud—persistent, resumable event streams over HTTP with unlimited streams, reads, and writes.
excerpt: >-
  We spent 3 years building a Postgres-native sync engine. Along the way, we realized the most important thing we built wasn't Postgres sync—it was the primitive underneath. With this release, you can stream and sync any kind of data through a single cloud platform.
authors: [kyle]
image: /img/blog/announcing-hosted-durable-streams/hero.png
tags: [durable-streams, cloud, agentic, AI]
outline: [2, 3]
post: true
---

<script setup>
import YoutubeEmbed from '../../src/components/YoutubeEmbed.vue'
</script>

<style scoped>
  .embed-container {
    margin: 24px 0;
    border-radius: 2px;
    overflow: hidden;
  }
</style>

We spent 3 years building a Postgres-native sync engine. Along the way, we realized the most important thing we built wasn't Postgres sync—it was the primitive underneath.

A year ago, AI apps barely worked because models couldn't follow instructions. That's solved. Claude Code refactors across fifty files and the tests still pass. Cursor is the new VSCode. The models are great.

Now infrastructure is the bottleneck. Token streams that resume when your train emerges from the tunnel, sessions that survive a refresh, agents coordinating without race conditions—none of this works out of the box. People cobble together Redis, WebSockets, and retry logic every time.

Turns out we'd built exactly the right primitive: durable streams. Crash-safe, resumable event streams over HTTP.

We [released the spec as 0.1.0](/blog/2025/12/09/announcing-durable-streams) in December. Today we're announcing 0.2.0—with idempotent producers and exactly-once semantics—and hosted durable streams on Electric Cloud.

## How it works

A durable stream is an addressable, append-only log with its own URL. Clients can read from any position, tail for live updates, or do both in one request—catch up on history, then seamlessly switch to real-time.

Existing streaming infrastructure wasn't designed for this. WebSockets and SSE are ephemeral. Kafka and Redis Streams are backend primitives—durable, but you're still building the client protocol yourself. Durable streams is the protocol: persistent, replayable, HTTP-native, with catch-up-and-tail built in.

Every write persists synchronously to Cloudflare's distributed storage before acknowledgment—zero data-loss window.

The details matter—readers don't hit origin, writes are idempotent, the protocol has layered semantics for different data shapes—but we covered all that in the [0.1.0 announcement](/blog/2025/12/09/announcing-durable-streams). What's new: the spec is mature, it's hosted, and it's the foundation for everything we're building next.

## What's shipping

Hosted durable streams is now live on [Electric Cloud](https://electric-sql.com/product/cloud), our managed sync platform.

- **Reads don't hit origin.** Electric Cloud's Sync CDN serves all reads. We've tested to 1M concurrent connections per stream.
- **Simple pricing.** Reads are free. 5 million writes/month free, then pay as you scale.
- **400+ conformance tests** (192 server, 212 client) ensuring protocol correctness.
- **Client libraries in 10 languages:** TypeScript, Python, Go, Rust, Java, Swift, PHP, Ruby, Elixir, and .NET—all passing full conformance.
- **AI SDK transports** for Vercel AI SDK and TanStack AI. Resumable token streaming without changing your backend.

## Get started

You don't have to rearchitect everything:

**Level one: Drop-in proxy.** Add our HTTP proxy with AI SDK transports to your existing stack. Your token streams become resumable—no code changes. You keep your existing backend, database, and deployment. Good for: making an existing AI app resumable without rearchitecting.

**Level two: Durable sessions.** Build directly on durable streams as your persistence layer. Persistent, multiplayer agent sessions that survive refreshes and maintain full history. Good for: new builds, multi-agent coordination, or apps where every participant needs to see every event. [Read more →](/blog/2026/01/12/durable-sessions-for-collaborative-ai)

The demo below shows Level two in action—multiple users and agents sharing a durable session, with full history replay and seamless reconnection:

<div class="embed-container" style="padding-bottom: 62.283737%">
  <YoutubeEmbed video-id="81KXwxld7dw" />
</div>

Sign up for [Electric Cloud](https://electric-sql.com/product/cloud) and create a service. Then create your first stream:

```bash
curl -X PUT \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  "https://api.electric-sql.cloud/v1/stream/<your-service-id>/my-stream"
```

Write to it, read from it, tail for live updates—all plain HTTP.

<!-- TODO: Add CLI demo video showing stream creation and writes -->

We're early—docs are sparse, guides are coming, and you'll be figuring some things out alongside us.

---

You've written the agent loop. You've debugged the WebSocket reconnection race. You've wondered if Redis PUBLISH actually delivered that message. You can stop now.

The protocol is production-ready. What we're still learning is ergonomics. What does it feel like to build with this? What do you wish it did? Tell us on Discord.

[Get started](https://electric-sql.com/product/cloud) · [Discord](https://discord.electric-sql.com)
