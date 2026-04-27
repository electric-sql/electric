---
title: Postgres Sync
description: >-
  Read-path sync engine for Postgres that handles partial replication, data delivery and fan-out.
outline: deep
---

<script setup>
import ComponentsJPG from '/static/img/docs/guides/deployment/components.jpg?url'
import ComponentsPNG from '/static/img/docs/guides/deployment/components.png?url'
import ComponentsSmPNG from '/static/img/docs/guides/deployment/components.sm.png?url'

import BlogPostsByTag from '../src/components/BlogPostsByTag.vue'
import GitHubButton from '../src/components/GitHubButton.vue'

import SyncStackDiagram from '../src/components/sync-home/SyncStackDiagram.vue'
import ShapeCarveDemo from '../src/components/sync-home/ShapeCarveDemo.vue'
import QueryLensDemo from '../src/components/sync-home/QueryLensDemo.vue'
import WritesLadder from '../src/components/sync-home/WritesLadder.vue'
</script>

<style scoped>
/* Constrain in-page demo components so they sit comfortably inside
   the docs content column (these were originally designed for the
   wider landing-page sections). */
.ps-demo {
  margin: 24px 0 32px;
}

/* QueryLensDemo is right-aligned by default (designed for the
   landing-page two-col layout). Inside the docs content column we
   want it centred. The :deep selector reaches into the scoped
   component and overrides its `margin-left: auto` rule. */
.ps-demo-center :deep(.qld) {
  margin-left: auto;
  margin-right: auto;
}
</style>

<img src="/img/icons/electric.svg" class="product-icon" alt="" />

# Postgres&nbsp;Sync

Read-path sync engine for Postgres that handles partial replication,
<span class="no-wrap-sm">
  data delivery and
  <span class="no-wrap">
    fan-out</span></span>.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="/docs/sync/quickstart"
        text="Quickstart"
        theme="brand"
    />
  </div>
  <div class="action">
    <VPButton
        href="/docs/sync"
        text="Docs"
        theme="alt"
    />
  </div>
  <div class="action">
    <GitHubButton repo="electric-sql/electric" />
  </div>
</div>

## Postgres sync engine

Postgres&nbsp;Sync is a sync engine that syncs [subsets of your data](/docs/sync/guides/shapes) out of your Postgres database, into local apps and services.

<div class="ps-demo">
  <SyncStackDiagram />
</div>

You can sync data into anything you like. From web, mobile and desktop apps and client stores like [TanStack&nbsp;DB](/sync/tanstack-db) to databases like [PGlite](/sync/pglite).

<div style="margin-top: 40px;">

> [!Warning] 🎓&nbsp; A quick note on naming
> Postgres&nbsp;Sync used to just be called "Electric" or the "Electric sync engine". Some docs and package names still use the old naming.

</div>

## How does it work?

Postgres&nbsp;Sync connects to your Postgres using a [`DATABASE_URL`](/docs/sync/api/config#database-url), consumes the logical replication stream and fans out data into [Shapes](/docs/sync/guides/shapes), which [Clients](/docs/sync/api/clients/typescript) then consume and sync.

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

Technically, Postgres&nbsp;Sync is an [Elixir](https://elixir-lang.org) application, developed at [packages/sync-service](https://github.com/electric-sql/electric/tree/main/packages/sync-service). It runs as a seperate service, [between your API and your database](/docs/sync/guides/deployment). Clients consume data over an [HTTP API](/docs/sync/api/http) that [works with CDNs](/docs/sync/api/http#caching) to scale data delivery and fan-out.

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

The same shape log is delivered to every subscriber &mdash; web tabs, mobile devices, server workers, agents &mdash; in real time, with the same ordering and guarantees. This allows you to have [millions of concurrent users](/docs/sync/reference/benchmarks) subscribing to real-time updates to your database with minimal additional load on your database.

## Define a Shape — sync just what you need

A **Shape** is a SQL query against your Postgres. Postgres&nbsp;Sync carves out the matching rows and keeps them live for every client that subscribes.

<div class="ps-demo">
  <ShapeCarveDemo />
</div>

See the [Shapes guide](/docs/sync/guides/shapes) for the full shape definition syntax, including `where` clauses, `columns` projection, and progressive loading.

## Query-driven sync

Your shape defines the **outer bounds** &mdash; the slice of Postgres a user is allowed to see. Live queries running on the client narrow that slice further, syncing only the rows actually needed for the current view.

<div class="ps-demo ps-demo-center">
  <QueryLensDemo />
</div>

[TanStack&nbsp;DB](/sync/tanstack-db) has this built in. Pick the sync mode that fits the work: **eager** to preload everything for instant interactions, **on-demand** to fetch only what the current query needs, or **progressive** to start fast and fill in the rest in the background.

See the [Live queries guide](https://tanstack.com/db/latest/docs/guides/live-queries) for the full TanStack&nbsp;DB sync-mode reference.

## Bring your own writes

Postgres&nbsp;Sync handles the read path. Writes go through your existing backend &mdash; pick how much sync you want on top.

<div class="ps-demo">
  <WritesLadder />
</div>

See the [Writes guide](/docs/sync/guides/writes) for the four write patterns and how to pair them with optimistic mutations in TanStack&nbsp;DB.

## Related posts

<BlogPostsByTag tag="postgres-sync" :limit="4" />

## More information

See the [Quickstart](/docs/sync/quickstart), the [Stacks](/docs/sync/stacks) overview, and the [HTTP API reference](/docs/sync/api/http). The full source is on GitHub at [electric-sql/electric](https://github.com/electric-sql/electric).

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="/docs/sync/quickstart"
        text="Quickstart"
        theme="brand"
    />
  </div>
  <div class="action">
    <VPButton
        href="/docs/sync"
        text="Docs"
        theme="alt"
    />
  </div>
  <div class="action">
    <GitHubButton repo="electric-sql/electric" />
  </div>
</div>
