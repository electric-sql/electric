---
title: Products
description: Composable sync primitives from ElectricSQL
image: /img/meta/electric-sync-primitives.jpg
outline: deep
---

<script setup>
import ProductsGrid from '../src/components/home/ProductsGrid.vue'
</script>

<p class="intro-zap-container">
  <img src="/img/home/zap-with-halo.svg"
      alt="Electric zap with halo"
      class="intro-zap"
  />
</p>

# Electric products

Composable sync primitives that work with your stack.

<ProductsGrid productPage />

## How they fit together {#how-they-fit-together}

The sync primitives in the Electric stack are designed to work together and work with your API and existing infrastructure.

In the diagram below, the white boxes are your components / infra.

<figure>
  <a href="/img/products/electric-stack-overview.lg.jpg" target="_blank">
    <img src="/img/products/electric-stack-overview.png" />
  </a>
</figure>

Postgres Sync connects to [your Postgres](/docs/guides/deployment#_1-running-postgres) and syncs data [over HTTP](/docs/api/http).

TanStack DB is the recommended client for application development. You can sync data into TanStack DB [from Electric](https://tanstack.com/db/latest/docs/collections/electric-collection) and/or [from a Durable Stream](/blog/2026/01/12/durable-sessions-for-collaborative-ai#reference-implementation). It also provides mutation primitives that work with your backend API.

PGlite is mainly used in [dev, test and sandbox environments](/blog/2025/06/05/database-in-the-sandbox). You can use it as a standalone embedded database or you can sync data into it [using Postgres Sync](https://pglite.dev/docs/sync).

## Which product should I use?

<div class="guidance-list">

<div class="guidance-item">
<img src="/img/home/sync-targets/app.svg" class="guidance-icon" />

### Building fast, modern apps?

Use [Postgres Sync](/products/postgres-sync) for data and [TanStack DB](/products/tanstack-db) for reactive state.

[Get started with Postgres Sync &rarr;](/products/postgres-sync)
</div>

<div class="guidance-item">
<img src="/img/home/sync-targets/agent.svg" class="guidance-icon" />

### Building collaborative AI apps?

Use [Durable Streams](/products/durable-streams) for AI responses and [TanStack DB](/products/tanstack-db) for state.

[Get started with Durable Streams &rarr;](/products/durable-streams)
</div>

<div class="guidance-item">
<img src="/img/home/sync-targets/worker.svg" class="guidance-icon" />

### Need drop-in AI SDK resilience?

Use the [Durable Streams](/products/durable-streams) transport adapter for Vercel AI SDK.

[Get started with Vercel AI SDK &rarr;](/docs/integrations/vercel)
</div>

<div class="guidance-item">
<img src="/img/icons/pglite.svg" class="guidance-icon" />

### Building sandboxed environments?

Use [PGlite](/products/pglite) for WASM Postgres with optional sync via Postgres Sync.

[Get started with PGlite &rarr;](/products/pglite)
</div>

</div>

---

Learn how these products enable different [sync solutions](/sync).

<style>
.guidance-list {
  margin: 24px 0 40px;
}

.guidance-item {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 20px;
  padding: 24px 0;
  border-bottom: 1px solid var(--vp-c-divider);
}

.guidance-item:last-child {
  border-bottom: none;
}

.guidance-icon {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
}

.guidance-item h3 {
  margin: 0 0 8px 0;
  font-size: 18px;
}

.guidance-item p {
  margin: 0 0 12px 0;
  color: var(--vp-c-text-2);
}

.guidance-item a {
  color: var(--vp-c-brand-1);
  font-weight: 500;
}

@media (max-width: 640px) {
  .guidance-item {
    flex-direction: column;
    gap: 12px;
  }
  .guidance-icon {
    width: 40px;
    height: 40px;
  }
}

.composition-diagram {
  margin: 24px 0;
  padding: 24px;
  background: var(--vp-c-bg-soft);
  border-radius: 12px;
  border: 1px solid rgba(42, 44, 52, 0.5);
  overflow-x: auto;
}

.composition-diagram pre {
  margin: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  line-height: 1.6;
  color: var(--vp-c-text-1);
}

</style>
