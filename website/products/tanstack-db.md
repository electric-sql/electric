---
title: TanStack DB
description: >-
  A reactive client database for building local-first web applications.
outline: deep
---

<script setup>
import BlogPostsByTag from '../src/components/BlogPostsByTag.vue'
</script>

<img src="/img/icons/tanstack-social.svg" class="product-icon" />

# TanStack DB

A reactive client database for building local-first web applications.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="https://tanstack.com/db/latest"
        text="Documentation"
        target="_blank"
        theme="electric"
    />
  </div>
  <div class="action">
    <VPButton href="https://github.com/TanStack/db"
        text="GitHub"
        target="_blank"
        theme="alt"
    />
  </div>
</div>

## What is TanStack DB?

TanStack DB is a reactive client-side database designed for local-first web applications. It provides a unified data layer that integrates with multiple sync backends, including [Postgres Sync](/products/postgres-sync) and [Durable Streams](/products/durable-streams).

Key features:

- **Reactive queries** &mdash; UI components automatically update when underlying data changes
- **Optimistic updates** &mdash; instant responsiveness with automatic conflict resolution
- **Multi-source sync** &mdash; combine data from Postgres Sync and Durable Streams in one client database
- **Framework integrations** &mdash; first-class support for React, Vue, and other frameworks

## Use cases

TanStack DB is ideal for:

- Local-first applications that need offline support and instant updates
- Collaborative apps where multiple users edit shared data
- Applications combining structured data (via Postgres Sync) with real-time streams (via Durable Streams)
- Any app that needs a reactive, queryable client-side data store

## How it works

TanStack DB acts as the client-side data layer in the Electric ecosystem. It receives data from multiple sources and provides a unified, reactive interface for your application.

```
Postgres Sync ────────────┐
(structured data)         │
                          ├───→ TanStack DB ───→ React/Vue/etc.
Durable Streams ──────────┘     (client DB)      (reactive UI)
(streams, AI, sessions)
```

Data flows from your backend through Electric's sync primitives into TanStack DB, which then powers your reactive UI components.

## Learn more

For an interactive guide to TanStack DB, how it works and why it might change the way you build apps, see [What TanStack DB is](https://frontendatscale.com/blog/tanstack-db).

## Showcase

See applications built with TanStack DB in the [TanStack Showcase](https://tanstack.com/showcase?page=1&libraryIds=%5B%22db%22%5D).

## Related posts

<BlogPostsByTag tag="tanstack-db" :limit="4" />

## More information

See the [Products overview](/products/) for guidance on how to combine TanStack DB with other Electric products. Check out the [Sync page](/sync) for outcome-focused solutions.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="https://tanstack.com/db/latest"
        text="Documentation"
        target="_blank"
        theme="electric"
    />
  </div>
  <div class="action">
    <VPButton href="https://github.com/TanStack/db"
        text="GitHub"
        target="_blank"
        theme="alt"
    />
  </div>
</div>
