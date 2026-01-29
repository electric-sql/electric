---
title: 'Announcing Hosted Durable Streams'
description: >-
  Hosted durable streams are now live on Electric Cloud. Persistent, resumable event streams over HTTP with unlimited streams, reads, and writes.
excerpt: >-
  Hosted durable streams are live on Electric Cloud. You can now sync and stream AI sessions and low-latency real-time data alongside structured database changes.
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

We spent 3 years [building a Postgres-native sync engine](/blog/2025/03/17/electricsql-1.0-released). Along the way, we realized the most important thing we built wasn't Postgres sync. It was the primitive underneath.

We [released](/blog/2025/12/09/announcing-durable-streams) this primitive as [Durable&nbsp;Streams](/products/durable-streams) in December. Today we're releasing version 0.2.0. This brings new features (like idempotent producers and exactly-once semantics) and turnkey, scalable hosting of Durable&nbsp;Streams on [Electric Cloud](/cloud).

## A new coordination model

A year ago, AI apps barely worked because models weren't good enough. Now, Claude Code refactors 50 files and the tests still pass. Cursor is the new VSCode. The models are more than good enough.

Today infrastructure is the bottleneck. However, it's not just infrastructure, it's a shift in the ***coordination model***.

[Request/response assumes two parties taking turns](/blog/2026/01/12/durable-sessions-for-collaborative-ai#evolving-the-interaction-paradigm). Agentic apps have multiple agents and multiple users all acting at once. That requires a different primitive. And people are cobbling together Redis, WebSockets, and retry logic to build it.

So it turns out we'd built exactly the right primitive for this moment: [Durable&nbsp;Streams](/products/durable-streams). Persistent, resumable event streams over HTTP.

## The missing primitive

A durable stream is an addressable, append-only log with its own URL. Clients can read from the log from any position and tail for live updates.

Existing streaming infrastructure wasn't designed for this. WebSockets and SSE are ephemeral. Kafka and Redis Streams are backend primitives—durable, but you're still building the client protocol yourself.

This is the coordination model that multi-agent and multi-user systems need. A shared log that everyone can read, resume, and react to. We call this pattern Durable Sessions—[read James' recent post about it](/blog/2026/01/12/durable-sessions-for-collaborative-ai).

Here's a demo—a multiplayer AI chat where multiple users and agents share a session with full history replay and seamless reconnection:

<div class="embed-container" style="padding-bottom: 62.283737%">
  <YoutubeEmbed video-id="81KXwxld7dw" />
</div>

With 0.2.0, the protocol is mature—we're ready for more people to build with it. For the full technical details, see the [0.1.0 announcement](/blog/2025/12/09/announcing-durable-streams).

## What's shipping

Hosted durable streams is now live on [Electric Cloud](/cloud), our managed sync platform. Electric Cloud also hosts [Postgres sync](/products/postgres-sync), so you can combine real-time streams with synced relational data in the same app.

- **Reads don't hit origin.** Electric Cloud's Sync CDN serves all reads. We've tested to 1M concurrent connections per stream.
- **Fast writes.** 240K writes/second for small messages, with 15-25 MB/sec sustained throughput.
- **Simple pricing.** Reads are free. 5 million writes/month free, then pay as you scale.
- **400+ conformance tests** (192 server, 212 client) ensuring protocol correctness.
- **Client libraries in 10 languages:** TypeScript, Python, Go, Rust, Java, Swift, PHP, Ruby, Elixir, and .NET—all passing full conformance.

## Get started

Sign up for [Electric Cloud](/cloud) and create a service. Then create your first stream:

```bash
curl -X PUT \
  -H "Authorization: Bearer <your-token>" \
  -H "Content-Type: application/json" \
  "https://api.electric-sql.cloud/v1/stream/<your-service-id>/my-stream"
```

Write to it, read from it, tail for live updates—all plain HTTP.

<div class="embed-container" style="padding-bottom: 62.283737%">
  <YoutubeEmbed video-id="y81PbquFq9I" />
</div>

### Coming soon

Drop-in AI SDK transports for Vercel AI SDK and TanStack AI. Yjs support for collaborative editing. An HTTP proxy that makes your existing token streams resumable with no code changes.

## Next steps

You've written the agent loop. You've debugged the WebSocket reconnection race. You've wondered if Redis `PUBLISH` actually delivered that message. You can stop now.

We're early. Docs are sparse, guides are coming, and you'll be figuring some things out alongside us. However the [protocol is production-ready](/blog/2025/03/17/electricsql-1.0-released).

What we're still learning is ergonomics. What does it feel like to build with this? What do you wish it did? We're all learning together how to build sophisticated, malleable, agentic applications and we'd love your feedback and contributions to building the infra we all need.

You can [get started with Cloud here](/cloud) and you can [join our community Discord here](https://discord.electric-sql.com).
