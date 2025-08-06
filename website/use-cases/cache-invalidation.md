---
title: "Cache invalidation"
description: >-
  Replace ttls and expiry policies with
  realtime sync and
  automated invalidation.
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

<script setup>
import { ref } from 'vue'

// Modal states
const isCacheInvalidationMechanismModalOpen = ref(false)
const isCacheInvalidationElectricModalOpen = ref(false)
</script>

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
    <div class="clickable-image" @click="isCacheInvalidationMechanismModalOpen = true">
      <img src="/img/use-cases/cache-invalidation-mechanism.png"
          alt="Diagramme illustrating the need for a cache invalidation mechanism"
      />
      <div class="image-overlay">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
          <line x1="11" y1="8" x2="11" y2="14"></line>
          <line x1="8" y1="11" x2="14" y2="11"></line>
        </svg>
      </div>
    </div>
  </div>
</figure>

<ImageModal
:is-open="isCacheInvalidationMechanismModalOpen"
image-src="/img/use-cases/cache-invalidation-mechanism.png"
image-alt="Diagramme illustrating the need for a cache invalidation mechanism"
@close="isCacheInvalidationMechanismModalOpen = false"
/>

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
    <div class="clickable-image" @click="isCacheInvalidationElectricModalOpen = true">
      <img src="/img/use-cases/cache-invalidation-electric.png"
          alt="Diagramme illustrating Electric cache invalidation"
      />
      <div class="image-overlay">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
          <line x1="11" y1="8" x2="11" y2="14"></line>
          <line x1="8" y1="11" x2="14" y2="11"></line>
        </svg>
      </div>
    </div>
  </div>
</figure>

<ImageModal
:is-open="isCacheInvalidationElectricModalOpen"
image-src="/img/use-cases/cache-invalidation-electric.png"
image-alt="Diagramme illustrating Electric cache invalidation"
@close="isCacheInvalidationElectricModalOpen = false"
/>

### Automated cache invalidation

Electric automatically manages the data in your local cache for you. When the data changes, the changes are synced to the local cache which is automatically updated.

You don't need to manage cache invalidation seperately or set expiry dates of TTLs on the records in the cache. Electric handles it for you.

## Real world example

See the [Redis example](/demos/redis) and [integration page](/docs/integrations/redis) for a real world example, syncing data into a Redis cache with automatic invalidation.

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
    <VPButton href="/demos"
        target="_blank"
        text="Demos"
        theme="alt"
    />
  </div>
</div>
