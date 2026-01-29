---
title: Durable Streams
description: >-
  Persistent, addressable, real-time streams that power resilient, collaborative AI applications.
image: /img/meta/durable-streams.jpg
outline: deep
---

<script setup>
import BlogPostsByTag from '../src/components/BlogPostsByTag.vue'
import GitHubButton from '../src/components/GitHubButton.vue'
</script>

<img src="/img/icons/durable-streams.svg" class="product-icon" />

# Durable Streams

Persistent, addressable, real-time streams that power resilient,
<span class="no-wrap-sm">
  collaborative
  <span class="no-wrap">
    AI applications.</span></span>

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="https://github.com/durable-streams/durable-streams/blob/main/README.md"
        text="README ↗"
        theme="durable-streams"
    />
  </div>
  <div class="action">
    <GitHubButton repo="durable-streams/durable-streams" />
  </div>
</div>

## What are Durable Streams?

Durable Streams are persistent, addressable, real-time streams. They're a flexible,
<span class="no-wrap">
  swiss-army-knife</span>
data primitive that's ideal for:

- token streaming
- collaborative AI sessions
- real-time presence

They're resumeable and resilient to patchy connectivity. They're high-throughput, low-latency and highly scalable. They unlock building [multi-user, multi-agent systems](/blog/2026/01/12/durable-sessions-for-collaborative-ai).

They're extensible, with [wrapper protocols](#wrapper-protocols) for everything from type-safe JSON streams running off a Standard Schema, to multi-modal data and structured database&nbsp;sync.

## Why do we need them?

Modern applications frequently need ordered, durable sequences of data that can be replayed from arbitrary points and tailed in real time.

Durable Streams addresses this gap for apps and agents across all platforms: web browsers, mobile apps, native clients, IoT devices, and edge workers.

### Use cases

- **token streaming** - stream LLM token responses
- **agentic apps** - stream tool outputs and events
- **database sync** - stream database changes
- **collaborative editing** - sync CRDTs and OTs across devices
- **real-time updates** - push state to clients and workers
- **workflow execution** - build durable workflows on durable state

### Benefits

- **multi-tab** - works seamlessly and efficiently across browser tabs
- **multi-device** - start on your laptop, continue on your phone
- **never re-run** - don't repeat expensive work because of a disconnect
- **share links** - consume and interact with the same stream
- **refresh-safe** - refresh the page, switch tabs or background the app
- **massive fan-out** - scale to millions of concurrent viewers

## How do they work?

The core primitive is a byte stream that can be written to and consumed via an [open&nbsp;protocol](https://github.com/durable-streams/durable-streams/blob/main/PROTOCOL.md) using a wide range of [client&nbsp;libraries](https://github.com/durable-streams/durable-streams/tree/main/packages).

### Resilient, scalable data delivery

The protocol is a generalization of the Electric [HTTP API](/docs/api/http).

It ensures resilience and reliable, exactly-once message delivery. Which can be scaled out through existing CDN infrastructure.

### High throughput, low-latency

The core streams are extremely simple: append-only binary logs.

As a result, they support very high throughput (millions of writes per second) and can be cached and served with single-digit ms latency at the cloud edge.

### Real-time and asynchronous collaboration

Streams are persistent and addressible, with their own storage and URL.

Clients can consume the stream from any position in the log, providing message history and resumability. They can connect and subscribe to them at any time, for both asynchronous and real-time collaboration.

## Wrapper protocols

Durable Streams support multiple wrapper protocols for different use cases:

- **Binary streams** &mdash; efficient binary encoding for high-throughput data
- **JSON mode** &mdash; human-readable JSON for debugging and interoperability
- **Proxy** &mdash; transparent proxy mode for existing SSE endpoints
- **Durable state** &mdash; persisted session state with automatic recovery
- **TanStack AI** &mdash; integration with TanStack Query for AI responses
- **Vercel AI SDK** &mdash; drop-in transport adapter for Vercel AI SDK
- **Yjs** &mdash; CRDT-based collaborative editing with Yjs

## Related posts

<BlogPostsByTag tag="durable-streams" />

## More information

See the [project on GitHub](https://github.com/durable-streams/durable-streams) for more info.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="https://github.com/durable-streams/durable-streams/blob/main/README.md"
        text="README ↗"
        theme="durable-streams"
    />
  </div>
  <div class="action">
    <GitHubButton repo="durable-streams/durable-streams" />
  </div>
</div>
