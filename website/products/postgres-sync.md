---
title: Postgres Sync
description: >-
  Read-path sync engine for Postgres that handles partial replication, data delivery and fan-out.
image: /img/meta/postgres-sync.jpg
outline: deep
---

<script setup>
import ComponentsJPG from '/static/img/docs/guides/deployment/components.jpg?url'
import ComponentsPNG from '/static/img/docs/guides/deployment/components.png?url'
import ComponentsSmPNG from '/static/img/docs/guides/deployment/components.sm.png?url'

import BlogPostsByTag from '../src/components/BlogPostsByTag.vue'
import GitHubButton from '../src/components/GitHubButton.vue'
</script>

<img src="/img/icons/electric.svg" class="product-icon" />

# Postgres&nbsp;Sync

Read-path sync engine for Postgres that handles partial replication,
<span class="no-wrap-sm">
  data delivery and
  <span class="no-wrap">
    fan-out</span></span>.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="/docs/quickstart"
        text="Quickstart"
        theme="brand"
    />
  </div>
  <div class="action">
    <GitHubButton repo="electric-sql/electric" />
  </div>
</div>

## Postgres sync engine

Postgres&nbsp;Sync is a sync engine that syncs [subsets of your data](/docs/guides/shapes) out of your Postgres database, into local apps and services.

<img srcset="/img/about/use-cases.sm.png 1098w, /img/about/use-cases.png 1484w"
    sizes="(max-width: 767px) 600px, 1484px"
    src="/img/about/use-cases.png"
    alt="Use cases diagram"
/>

You can sync data into anything you like. From web, mobile and desktop apps and client stores like [TanStack&nbsp;DB](/products/tanstack-db) to databases like [PGlite](/products/pglite).

<div style="margin-top: 40px;">

> [!Warning] 🎓&nbsp; A quick note on naming
> Postgres&nbsp;Sync used to just be called "Electric" or the "Electric sync engine". Some docs and package names still use the old naming.

</div>

## How does it work?

Postgres&nbsp;Sync connects to your Postgres using a [`DATABASE_URL`](/docs/api/config#database-url), consumes the logical replication stream and fans out data into [Shapes](/docs/guides/shapes), which [Clients](/docs/api/clients/typescript) then consume and sync.

<figure>
  <a href="/img/api/shape-log.jpg">
    <img srcset="/img/api/shape-log.sm.png 1064w, /img/api/shape-log.png 1396w"
        sizes="(max-width: 767px) 600px, 1396px"
        src="/img/api/shape-log.png"
        alt="Shape log flow diagram"
    />
  </a>
  <figcaption class="figure-caption text-end">
    Shape log flow diagram.
  </figcaption>
</figure>

Technically, Postgres&nbsp;Sync is an [Elixir](https://elixir-lang.org) application, developed at [packages/sync-service](https://github.com/electric-sql/electric/tree/main/packages/sync-service). It runs as a seperate service, [between your API and your database](/docs/guides/deployment). Clients consume data over an [HTTP API](/docs/api/http) that [works with CDNs](/docs/api/http#caching) to scale data delivery and fan-out.

<figure>
  <a :href="ComponentsJPG">
    <img :src="ComponentsPNG" class="hidden-sm"
        alt="Illustration of the main components of a successfull deployment"
    />
    <img :src="ComponentsSmPNG" class="block-sm"
        style="max-width: 360px"
        alt="Illustration of the main components of a successfull deployment"
    />
  </a>
</figure>

This allows you to have [millions of concurrent users](/docs/reference/benchmarks) subscribing to real-time updates to your database with minimal additional load on your database.

## Related posts

<BlogPostsByTag tag="postgres-sync" :limit="4" />

## More information

See the [Quickstart](/docs/quickstart), [Docs](/docs/intro) and [Demos](/demos).

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="/docs/quickstart"
        text="Quickstart"
        theme="brand"
    />
  </div>
  <div class="action">
    <GitHubButton repo="electric-sql/electric" text="Star on GitHub" />
  </div>
</div>
