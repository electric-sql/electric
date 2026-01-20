---
title: Durable Streams
description: >-
  Resilient data streams for AI agents and real-time applications.
outline: deep
---

<script setup>
import BlogPostsByTag from '../src/components/BlogPostsByTag.vue'
</script>

<img src="/img/icons/durable-streams.svg" class="product-icon" />

# Durable Streams

Resilient data streams for AI agents and real-time applications.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="https://github.com/electric-sql/durable-streams"
        text="GitHub"
        target="_blank"
        theme="durable-streams"
    />
  </div>
</div>

## What are Durable Streams?

Durable Streams provide reliable, resumable data streams for applications that need to survive network interruptions. They're designed for AI agents, collaborative applications, and any system that requires resilient real-time data flow.

Key features:

- **Resumable connections** &mdash; automatically resume from the last known position after disconnection
- **Durable state** &mdash; maintain session state across reconnections
- **AI SDK adapters** &mdash; drop-in transport adapters for popular AI frameworks

## Use cases

Durable Streams are ideal for:

- AI agents that need to maintain context across network interruptions
- Collaborative applications with multiple users and agents
- Real-time dashboards that must not lose data
- Multi-step agentic workflows that span long time periods

## How it works

Durable Streams work alongside [Postgres Sync](/products/postgres-sync) and [TanStack DB](/products/tanstack-db) to provide a complete sync solution. While Postgres Sync handles structured data, Durable Streams handle event streams, AI responses, and session state.

```
Postgres Sync ────────────┐
(structured data)         │
                          ├───→ TanStack DB
Durable Streams ──────────┘     (reactive client DB)
(streams, AI, sessions)
```

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

See the [Products overview](/products/) for guidance on how to combine Durable Streams with other Electric products. Check out the [Sync page](/sync) for outcome-focused solutions.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="https://github.com/electric-sql/durable-streams"
        text="GitHub"
        target="_blank"
        theme="durable-streams"
    />
  </div>
</div>
