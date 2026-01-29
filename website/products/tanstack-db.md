---
title: TanStack DB
description: >-
  Reactive client store for building super-fast apps. With sub-millisecond reactivity and instant local writes.
image: /img/meta/tanstack-db.jpg
outline: deep
---

<script setup>
import BlogPostsByTag from '../src/components/BlogPostsByTag.vue'
import GitHubButton from '../src/components/GitHubButton.vue'
</script>

<style scoped>
figure.listing {
  display: grid;
  grid-template-columns: 1fr;
  gap: 24px;
}
figure.listing img {
  border-radius: 16px;
}
@media (min-width: 650px) {
  figure.listing {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>

<img src="/img/icons/tanstack.svg" class="product-icon" />

# TanStack&nbsp;DB

Reactive client store for building <span class="no-wrap">super-fast apps</span>. With sub-millisecond reactivity <span class="no-wrap">and instant local writes</span>.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="/docs/quickstart"
        text="Quickstart"
        theme="brand"
    />
  </div>
  <div class="action hidden-sm">
    <VPButton
        href="https://tanstack.com/db/latest"
        text="TanStack/db ↗"
        target="_blank"
        theme="alt"
    />
  </div>
  <div class="action inline-sm">
    <VPButton
        href="https://tanstack.com/db/latest"
        text="Docs ↗"
        target="_blank"
        theme="alt"
    />
  </div>
  <div class="action">
    <GitHubButton repo="tanstack/db" />
  </div>
</div>

## What is TanStack&nbsp;DB?

[TanStack&nbsp;DB](https://tanstack.com/db) is a reactive, client-first store that keeps your UI reactive, consistent and <span class="no-wrap-md">blazing fast&nbsp;🔥</span>

## Why do we need it?

TanStack&nbsp;DB lets you query your data however your components need it, with a blazing-fast local query engine, real-time reactivity and instant optimistic updates:

- avoid endpoint sprawl and network waterfalls
- optimise client performance and re-rendering
- take the network off the interaction path

Data loading is optimized. Interactions feel instantaneous. Your backend stays simple and your app stays blazing fast. No matter how much data you load.

### Use cases

TanStack&nbsp;DB is ideal for:

- modern apps that need fast, responsive UI
- collaborative apps where multiple users edit shared data
- applications combining structured data (via Postgres&nbsp;Sync) with real-time streams (via Durable&nbsp;Streams)
- applications that combine real-time sync with API-based data fetching
- any app that needs a reactive, queryable client-side data store

## How it works

Built on a Typescript implementation of [differential dataflow](https://github.com/electric-sql/d2ts), TanStack&nbsp;DB provides three core primitives:

1. [collections](https://tanstack.com/db/latest/docs/overview#defining-collections) a unified data layer to load data into
1. [live queries](https://tanstack.com/db/latest/docs/guides/live-queries) super-fast reactivity using differential dataflow
1. [optimistic mutations](https://tanstack.com/db/latest/docs/guides/mutations) that tie into the sync machinery

### Data flow

TanStack&nbsp;DB acts as the client-side data layer in [the Electric ecosystem](/products/#how-they-fit-together). Data flows from your backend through Electric's sync primitives into TanStack&nbsp;DB, which then powers your reactive UI components.

<figure>
  <a href="https://tanstack.com/db/latest/docs/overview#uni-directional-data-flow" class="no-visual">
    <img src="/img/products/unidirectional-data-flow.png"
        style="width: 100%; max-width: 640px; margin: -8px 0 -8px -2px"
    />
  </a>
</figure>

You can load and sync data into it from multiple sources, including [your API](https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query), [Postgres&nbsp;Sync](/products/postgres-sync) and [Durable&nbsp;Streams](/products/durable-streams).

TanStack&nbsp;DB then provides a unified, reactive interface to the data.

### Query-driven sync

When used with Postgres&nbsp;Sync, TanStack&nbsp;DB leverages [progressive data loading](/docs/guides/shapes#progressive-data-loading) to implement [query-driven sync](https://tanstack.com/blog/tanstack-db-0.5-query-driven-sync).

This means that you can progressively sync data into your app, in response to navigation, user input and events, just by defining live queries against your local client store.

### Learn more

See the blog post on [query-driven sync](https://tanstack.com/blog/tanstack-db-0.5-query-driven-sync) and the [interactive guide to TanStack&nbsp;DB](https://frontendatscale.com/blog/tanstack-db), how it works and why it might change the way you build apps:

<figure class="listing">
  <a href="https://tanstack.com/blog/tanstack-db-0.5-query-driven-sync" class="no-visual">
    <img alt="TanStack&nbsp;DB 0.5 . Query-Driven Sync"
        src="/img/products/query-driven-sync.jpg"
    />
  </a>
  <a href="https://frontendatscale.com/blog/tanstack-db" class="no-visual">
    <img alt="An Interactive Guide to TanStack&nbsp;DB"
        src="/img/blog/local-first-sync-with-tanstack-db/interactive-guide-to-tanstack-db.jpg"
    />
  </a>
</figure>

## Showcase

See applications built with TanStack&nbsp;DB in the [TanStack Showcase](https://tanstack.com/showcase?page=1&libraryIds=%5B%22db%22%5D).

## Related posts

<BlogPostsByTag tag="tanstack-db" :limit="4" />

## More information

See the [Quickstart](/docs/quickstart) and [TanStack docs](https://tanstack.com/db/latest/docs/overview).

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="/docs/quickstart"
        text="Quickstart"
        theme="brand"
    />
  </div>
  <div class="action hidden-sm">
    <VPButton
        href="https://tanstack.com/db/latest"
        text="TanStack/db ↗"
        target="_blank"
        theme="alt"
    />
  </div>
  <div class="action inline-sm">
    <VPButton
        href="https://tanstack.com/db/latest"
        text="Docs ↗"
        target="_blank"
        theme="alt"
    />
  </div>
  <div class="action">
    <GitHubButton repo="tanstack/db" />
  </div>
</div>
