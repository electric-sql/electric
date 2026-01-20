---
title: Products
description: Composable sync primitives from ElectricSQL
outline: deep
---

<script setup>
import Card from '../src/components/home/Card.vue'
</script>

# Products

Composable sync primitives that work with your stack.

<div class="products-grid">
  <Card
    href="/products/postgres-sync"
    icon="/img/icons/electric.svg"
    title="Postgres Sync"
    body="Sync data from Postgres into local apps with partial replication and live queries."
  />
  <Card
    href="/products/durable-streams"
    icon="/img/icons/durable-streams.svg"
    title="Durable Streams"
    body="Resumable streaming protocol for AI responses and multi-step workflows."
  />
  <Card
    href="/products/tanstack-db"
    icon="/img/icons/tanstack-social.svg"
    title="TanStack DB"
    body="Reactive client database with optimistic updates and sync integration."
  />
  <Card
    href="/products/pglite"
    icon="/img/icons/pglite.svg"
    title="PGlite"
    body="Lightweight WASM Postgres for browser, Node.js, and embedded use."
  />
</div>

## How they fit together {#how-they-fit-together}

The sync primitives are designed to compose. Postgres Sync and Durable Streams provide different data sources. TanStack DB provides a unified reactive client. PGlite provides embeddable Postgres.

<div class="composition-diagram">
<pre>
Data Sources                          Client
──────────────────────────────────────────────────────────────

Postgres Sync ─────────────────┐
(structured data)              │
                               ├────→  TanStack DB
Durable Streams ───────────────┘       (reactive client DB)
(streams, AI, sessions)


PGlite = WASM Postgres (dev, CI, test, sandboxed runtimes)
</pre>
</div>

## Which product should I use?

<div class="guidance-grid">
  <Card
    icon="/img/home/sync-targets/app.svg"
    title="Building fast, modern apps?"
    body="Use <a href='/products/postgres-sync'>Postgres Sync</a> for data and <a href='/products/tanstack-db'>TanStack DB</a> for reactive state."
  />
  <Card
    icon="/img/home/sync-targets/agent.svg"
    title="Building collaborative AI apps?"
    body="Use <a href='/products/durable-streams'>Durable Streams</a> for AI responses and <a href='/products/tanstack-db'>TanStack DB</a> for state."
  />
  <Card
    icon="/img/home/sync-targets/worker.svg"
    title="Need drop-in AI SDK resilience?"
    body="Use the <a href='/products/durable-streams'>Durable Streams</a> transport adapter for Vercel AI SDK."
  />
  <Card
    icon="/img/icons/pglite.svg"
    title="Building sandboxed environments?"
    body="Use <a href='/products/pglite'>PGlite</a> for WASM Postgres with optional sync via Postgres Sync."
  />
</div>

---

Learn how these products enable different [sync solutions](/sync).

<style>
.guidance-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
  margin: 24px 0 40px;
  align-items: stretch;
}

.guidance-grid :deep(.card) {
  height: 100%;
}

.guidance-grid :deep(.body p a) {
  color: var(--electric-color);
}

@media (max-width: 768px) {
  .guidance-grid {
    grid-template-columns: 1fr;
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

.products-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
  margin: 24px 0 40px;
  align-items: stretch;
}

.products-grid :deep(.card) {
  height: 100%;
}

@media (max-width: 768px) {
  .products-grid {
    grid-template-columns: 1fr;
  }
}
</style>
