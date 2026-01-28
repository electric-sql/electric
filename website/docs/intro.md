---
title: Documentation
description: >-
  How to build fast, modern, collaborative apps with the Electric stack.
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

How to build [fast, modern, collaborative apps](/sync) with the Electric stack.

## Getting started

Start with the [Quickstart](/docs/quickstart) for the fastest way to get up-and-running.

The easiest way to use Electric in production is the [Electric Cloud](/cloud). Alternatively, the [Deployment](/docs/guides/deployment) guide covers how to self host.

## What's documented where?

> [!Warning] 🔭&nbsp; Product documentation is split across multiple sites
> It's worth taking a moment to understand what's documented where.

This website contains the main documentation for [Postgres Sync](/products/postgres-sync).

Usage examples and recipes often use Postgres Sync together with [TanStack&nbsp;DB](/products/tanstack-db). Guides like [Auth](/docs/guides/auth) and [Security](/docs/guides/security) are also generally relevant for [Durable Streams](/products/durable-streams).

### Project websites

[Durable Streams](/products/durable-streams), [TanStack DB](/products/tanstack-db) and [PGlite](/products/pglite) each have their own docs:

<div class="product-signposts">
  <a href="https://github.com/durable-streams/durable-streams"
      class="product-signpost no-visual">
    <img src="/img/icons/durable-streams.svg" alt="Durable Streams" />
    <div>
      <h3>Durable Streams</h3>
      <p>github.com/durable-streams</p>
    </div>
  </a>
  <a href="https://tanstack.com/db" class="product-signpost no-visual">
    <img src="/img/icons/tanstack.svg" alt="TanStack DB" />
    <div>
      <h3>TanStack DB</h3>
      <p>tanstack.com/db</p>
    </div>
  </a>
  <a href="https://pglite.dev" class="product-signpost no-visual">
    <img src="/img/icons/pglite.product.svg" alt="PGlite" class="pglite" />
    <div>
      <h3>PGlite</h3>
      <p>pglite.dev</p>
    </div>
  </a>
</div>

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
  grid-template-columns: repeat(1, 1fr);
  gap: 16px;
  margin: 24px 0 32px;
}

.product-signpost {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
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
  width: 52px;
  height: 52px;
  flex-shrink: 0;
}
.product-signpost img.pglite {
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  padding: 2px;
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
