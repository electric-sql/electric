---
title: Sync
description: >-
  Build fast, resilient, and collaborative applications with composable sync primitives
outline: deep
---

<script setup>
import { VPButton } from 'vitepress/theme'
</script>

<img src="/img/icons/electric.svg" class="product-icon" />

# Sync makes apps awesome

Sync is the magic ingredient behind fast, modern software. From apps like Figma and Linear to multi-user, multi-agent AI applications.

<div class="actions cta-actions">
  <div class="action">
    <VPButton
        href="/products"
        text="View products"
        theme="brand"
    />
  </div>
  <div class="action">
    <VPButton
        href="https://dashboard.electric-sql.cloud/"
        text="Sign up"
        theme="alt"
    />
  </div>
</div>

## Why sync?

Applications today are increasingly real-time and collaborative. Users expect instant updates, offline support, and seamless multi-user experiences. Traditional request-response architectures can't keep up.

Sync provides a fundamentally better approach: instead of fetching data on demand, you sync data proactively. This enables instant UI updates, offline-first experiences, and automatic conflict resolution.

---

## What you can build {#solutions}

<div class="sync-cards">

### Fast, modern apps {#fast-modern-apps}

<img src="/img/home/sync-targets/app.svg" class="sync-card-icon" />

Build apps like Linear and Figma with instant, optimistic UI. Sync data into a local store for sub-millisecond reads and updates that feel instantaneous.

**Use:** [Postgres Sync](/products/postgres-sync) + [TanStack DB](/products/tanstack-db)

### Resilient AI apps {#resilient-ai-apps}

<img src="/img/home/sync-targets/agent.svg" class="sync-card-icon" />

AI apps that work reliably, even with patchy connectivity. Durable streams ensure AI responses are never lost and can resume from any point.

**Use:** [Durable Streams](/products/durable-streams)

### Collaborative AI apps {#collaborative-ai-apps}

<img src="/img/home/sync-targets/agent.svg" class="sync-card-icon" />

Multi-user, multi-agent apps with real-time collaboration. Sync shared state between users and AI agents with automatic conflict resolution.

**Use:** [Durable Streams](/products/durable-streams) + [TanStack DB](/products/tanstack-db)

### Real-time dashboards {#real-time-dashboards}

<img src="/img/home/sync-targets/dashboard.svg" class="sync-card-icon" />

Live analytics and monitoring dashboards that update instantly. Stream changes from Postgres to dashboards without polling or complex infrastructure.

**Use:** [Postgres Sync](/products/postgres-sync) + [TanStack DB](/products/tanstack-db)

### Durable workflows {#durable-workflows}

<img src="/img/home/sync-targets/worker.svg" class="sync-card-icon" />

Multi-step agentic workflows that resume after failures. Build reliable, long-running processes with durable state and event streams.

**Use:** [Durable Streams](/products/durable-streams)

</div>

---

## Get started

Ready to build with sync? Explore our products to find the right tools for your use case.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="/products"
        text="View products"
        theme="brand"
    />
  </div>
  <div class="action">
    <VPButton
        href="/docs/quickstart"
        text="Quickstart"
        theme="alt"
    />
  </div>
</div>

<style>
.sync-cards {
  margin: 32px 0;
}

.sync-cards h3 {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--vp-c-divider);
}

.sync-cards h3:first-of-type {
  border-top: none;
  padding-top: 0;
}

.sync-card-icon {
  width: 32px;
  height: 32px;
  display: none;
}

.sync-cards p {
  margin: 8px 0;
}

.sync-cards p strong {
  color: var(--vp-c-text-2);
  font-weight: 500;
}
</style>
