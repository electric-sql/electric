---
title: Durable Streams
description: >-
  Resilient data streams for AI agents and real-time applications.
outline: deep
---

<script setup>
import BlogPostsByTag from '../src/components/BlogPostsByTag.vue'
</script>

<img src="/img/home/sync-targets/worker.svg" class="product-icon" />

# Durable Streams

Resilient data streams for AI agents and real-time applications.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="https://github.com/electric-sql/electric/tree/main/packages/durable-streams"
        text="Documentation"
        target="_blank"
        theme="electric"
    />
  </div>
  <div class="action">
    <VPButton href="https://github.com/electric-sql/electric"
        text="GitHub"
        target="_blank"
        theme="alt"
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

## Related posts

<BlogPostsByTag tag="durable-streams" />

## More information

See the [Products overview]((/products/) for guidance on how to combine Durable Streams with other Electric products. Check out the [Sync page](/sync) for outcome-focused solutions.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="https://github.com/electric-sql/electric/tree/main/packages/durable-streams"
        text="Documentation"
        target="_blank"
        theme="electric"
    />
  </div>
  <div class="action">
    <VPButton href="https://github.com/electric-sql/electric"
        text="GitHub"
        target="_blank"
        theme="alt"
    />
  </div>
</div>
