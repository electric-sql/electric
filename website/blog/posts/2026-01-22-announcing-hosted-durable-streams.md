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

A year ago, AI apps barely worked because models weren't good enough. Now Claude Code refactors across fifty files and the tests still pass. Cursor is the new VSCode. The models are great.

Now infrastructure is the bottleneck. Token streams that are reliable, sessions that survive a refresh, agents coordinating without race conditions—none of this works out of the box. People are cobbling together Redis, WebSockets, and retry logic.

So it turns out we'd built exactly the right primitive for this moment: durable streams. Persistent, resumable event streams over HTTP.

We first [released the Durable Streams protocol](/blog/2025/12/09/announcing-durable-streams) in December. Today we're announcing 0.2.0—with idempotent producers and exactly-once semantics—*and* hosted durable streams on Electric Cloud.

## How it works

A durable stream is an addressable, append-only log with its own URL. Clients can read from any position and tail for live updates.

Existing streaming infrastructure wasn't designed for this. WebSockets and SSE are ephemeral. Kafka and Redis Streams are backend primitives—durable, but you're still building the client protocol yourself.

This primitive turns out to be exactly what multi-agent and multi-user systems need. Shared mutable state breaks down when you have three agents and two users all updating at once. Request-response doesn't work when every participant needs to see every tool call. A shared log that everyone can read, resume, and react to is the only coordination primitive that survives multiplayer. We call this pattern Durable Sessions—[read James' recent post about it](/blog/2026/01/12/durable-sessions-for-collaborative-ai).

Here's a demo—a multiplayer AI chat where multiple users and agents share a session with full history replay and seamless reconnection:

<div class="embed-container" style="padding-bottom: 62.283737%">
  <YoutubeEmbed video-id="y81PbquFq9I" />
</div>

With 0.2.0, the protocol is mature—we're ready for more people to build with it. For the full technical details, see the [0.1.0 announcement](/blog/2025/12/09/announcing-durable-streams).

## What's shipping

Hosted durable streams is now live on [Electric Cloud](https://electric-sql.com/product/cloud), our managed sync platform.

- **Reads don't hit origin.** Electric Cloud's Sync CDN serves all reads. We've tested to 1M concurrent connections per stream.
- **Simple pricing.** Reads are free. 5 million writes/month free, then pay as you scale.
- **400+ conformance tests** (192 server, 212 client) ensuring protocol correctness.
- **Client libraries in 10 languages:** TypeScript, Python, Go, Rust, Java, Swift, PHP, Ruby, Elixir, and .NET—all passing full conformance.

## Get started

Sign up for [Electric Cloud](https://electric-sql.com/product/cloud) and create a service. Then create your first stream:

```bash
curl -X PUT \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  "https://api.electric-sql.cloud/v1/stream/<your-service-id>/my-stream"
```

Write to it, read from it, tail for live updates—all plain HTTP.

<!-- TODO: Add CLI demo video showing stream creation and writes -->


**Coming soon:** Drop-in AI SDK transports for Vercel AI SDK and TanStack AI, Yjs support for collaborative editing, and an HTTP proxy that makes your existing token streams resumable with no code changes.

---

You've written the agent loop. You've debugged the WebSocket reconnection race. You've wondered if Redis PUBLISH actually delivered that message. You can stop now.

We're early—docs are sparse, guides are coming, and you'll be figuring some things out alongside us.

But the protocol is production-ready. What we're still learning is ergonomics. What does it feel like to build with this? What do you wish it did? We're all learning together how to build sophisticated, malleable, agentic applications.

[Get started](https://electric-sql.com/product/cloud) · [Discord](https://discord.electric-sql.com)
