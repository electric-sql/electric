---
title: "Cache invalidation"
description: >-
  Replace ttls and expiry policies with
  realtime sync and
  automated invalidation.
image: /img/use-cases/cache-invalidation.png
outline: deep
case: true
homepage: true
homepage_order: 20
solves: "cache invalidation"
benefits:
  - Simplifies your stack
  - No more stale data
---

<style scoped>
  .cache-invalidation-diagramme {
    width: 100%;
  }
  .cache-invalidation-diagramme img {
    width: 100%;
    max-width: 420px;
  }
  @media (max-width: 767px) {
    .cache-invalidation-diagramme {
      padding: 0 10px;
    }
    .cache-invalidation-diagramme img {
      margin: 0 auto;
    }
  }
</style>

## Realtime caching with automatic invalidation

Caches are seperate local copies of data, maintained close to application code. They speed up data access, reducing latency and increasing scalability.

The challenge with caching is invalidation, i.e.: keeping the cache up-to-date. This is famously one of the hardest problems in computer science.

Electric solves cache invalidation for you by automatically keeping data in sync.

## The problem with stale data

A lot of systems today use ad-hoc mechanisms to maintain caches and keep them up-to-date. This leads to engineering complexity, stale data and bad user experience.

This applies both to the data plumbing and the algorithms used to expire data.

### Data plumbing

Say you're maintaining a cache of recently updated projects. What happens when one of those projects is renamed? You need to update the cache. So you need a mechanism for reliably propagating updates from your main data source to the cache.

<figure>
  <div class="cache-invalidation-diagramme">
    <a href="/img/use-cases/cache-invalidation-mechanism.jpg" target="_blank">
      <img src="/img/use-cases/cache-invalidation-mechanism.png"
          alt="Diagramme illustrating the need for a cache invalidation mechanism"
      />
    </a>
  </div>
</figure>

This means you need durability, at-least-once delivery and to be able to recover from downtime. It's easy to get sucked into engineering complexity and it's easy to make mistakes, so a cache either gets stuck with stale data or wiped too often.

### Stale data

It's hard to know when a cache entry should be invalidated. Often, systems use ad-hoc expiry dates and "time to live" (or "ttls").

This leads to stale data, which can lead to confused users, integrity violations and having to write code to put safeguards around data you can't trust.

## Solved by Electric

Electric solves data plumbing with realtime sync and solves stale data with automated cache invalidation.

### Realtime sync

Electric syncs data into caches in realtime. It's fast and reliable, handles durability/delivery and reconnecting after downtime. You just declare the Shape of the data you want in the cache and Electric keeps it in sync.

<figure>
  <div class="cache-invalidation-diagramme">
    <a href="/img/use-cases/cache-invalidation-electric.jpg" target="_blank">
      <img src="/img/use-cases/cache-invalidation-electric.png"
          alt="Diagramme illustrating Electric cache invalidation"
      />
    </a>
  </div>
</figure>

### Automated cache invalidation

Electric automatically manages the data in your local cache for you. When the data changes, the changes are synced to the local cache which is automatically updated.

You don't need to manage cache invalidation seperately or set expiry dates of TTLs on the records in the cache. Electric handles it for you.

## Real world example

Let's look at a real world example, syncing data into a Redis cache. You can see the [full source code here](https://github.com/electric-sql/electric/tree/main/examples/redis-client).

### Maintaining a Redis cache

Many applications use [Redis](https://redis.io/docs/latest/develop/use/client-side-caching/) as a local cache. With Electric, you can define a [Shape](/docs/guide/shape) and sync it into a [Redis hash](https://redis.io/docs/latest/develop/data-types/hashes/). The shape comes through as a [log](/docs/api/http#shape-log) of insert, update and delete messages. Apply these to the Redis hash and the cache automatically stays up-to-date:

<<< @../../examples/redis-client/src/index.ts

## Next steps

Get started with Electric to simplify your stack and avoid stale data.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="/docs/quickstart"
        text="Quickstart"
        theme="brand"
    />
  </div>
  <div class="action">
    <VPButton href="/docs/api/http"
        text="API docs"
        theme="alt"
    />
  </div>
  <div class="action hidden-sm">
    <VPButton href="https://github.com/electric-sql/electric/tree/main/examples"
        target="_blank"
        text="Examples"
        theme="alt"
    />
  </div>
</div>