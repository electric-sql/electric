---
title: Documentation
description: >-
  Welcome to the Electric developer documentation!
outline: deep
---

<script setup>
import { data as demosData } from '../data/demos.data.ts'
const { demos } = demosData

const burn = demos.find(x => x.link === '/demos/burn')
const linearlite = demos.find(x => x.link === '/demos/linearlite')
</script>

<img src="/img/icons/docs.svg" class="product-icon"
    style="width: 72px"
/>

# Documentation

Welcome to the Electric developer documentation!

Electric provides composable sync primitives for building fast, collaborative, and resilient apps. Our products work together to help you sync data into local apps, services, and environments.

## Our Products

<div class="product-signposts">

<a href="/products/postgres-sync" class="product-signpost">
<img src="/img/icons/electric.svg" alt="Postgres Sync" />
<div>
<h3>Postgres Sync</h3>
<p>Sync Postgres data into apps, workers and services</p>
</div>
</a>

<a href="/products/durable-streams" class="product-signpost">
<img src="/img/icons/durable-streams.svg" alt="Durable Streams" />
<div>
<h3>Durable Streams</h3>
<p>Resilient streaming for AI and real-time data</p>
</div>
</a>

<a href="/products/tanstack-db" class="product-signpost">
<img src="/img/icons/tanstack-social.svg" alt="TanStack DB" />
<div>
<h3>TanStack DB</h3>
<p>Reactive client store for super fast apps</p>
</div>
</a>

<a href="/products/pglite" class="product-signpost">
<img src="/img/icons/pglite.svg" alt="PGlite" />
<div>
<h3>PGlite</h3>
<p>Lightweight WASM Postgres with real-time bindings</p>
</div>
</a>

</div>

## Getting Started

Start with the [Quickstart](/docs/quickstart) to get up-and-running with Postgres Sync.

The [HTTP API](/docs/api/http) and [TypeScript Client](/docs/api/clients/typescript) docs and the guides on [Auth](/docs/guides/auth) and [Shapes](/docs/guides/shapes) are good entrypoints and helpful to understand how Electric works.

The [TanStack integration page](/docs/integrations/tanstack) then links to resources showing how to build super fast apps with Electric and TanStack DB.

The easiest way to use Electric in production is the [Electric Cloud](/cloud). Alternatively, the [Deployment](/docs/guides/deployment) guide covers how to self host.

> [!Note] External documentation
> - **Durable Streams** docs are at [github.com/electric-sql/durable-streams](https://github.com/electric-sql/durable-streams)
> - **TanStack DB** docs are at [tanstack.com/db](https://tanstack.com/db)
> - **PGlite** docs are at [pglite.dev/docs](https://pglite.dev/docs)

## Examples

See the [Demos](/demos) section and [`examples`](https://github.com/electric-sql/electric/tree/main/examples) folder on GitHub for demos and examples, e.g.:

<div class="demos-grid">
  <DemoListing :demo="burn"/>
  <DemoListing :demo="linearlite"/>
</div>

The integration docs also illustrate common patterns, e.g. using Electric with frameworks like [TanStack](/docs/integrations/tanstack) and [Phoenix](/docs/integrations/phoenix) and platforms like [Supabase](/docs/integrations/supabase) and [Cloudflare](/docs/integrations/cloudflare).

## Source code

Electric is an open source project developed at [github.com/electric-sql](https://github.com/electric-sql). Check out the source code, issues and development in progress there.

## Support

See the [Community page](/about/community) for information on support and events, including our [community Discord](https://discord.electric-sql.com) where you can ask questions and get support.

<style>
.product-signposts {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin: 24px 0 32px;
}

.product-signpost {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px;
  background-color: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  text-decoration: none;
  transition: border-color 0.2s ease;
}

.product-signpost:hover {
  border-color: var(--vp-c-brand-1);
}

.product-signpost img {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
}

.product-signpost h3 {
  margin: 0 0 4px 0;
  font-size: 1rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.product-signpost p {
  margin: 0;
  font-size: 0.85rem;
  color: var(--vp-c-text-2);
  line-height: 1.4;
}

@media (max-width: 640px) {
  .product-signposts {
    grid-template-columns: 1fr;
  }
}
</style>
