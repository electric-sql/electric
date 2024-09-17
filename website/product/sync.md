---
title: Sync
description: >-
  Sync little subsets of your Postgres data into
  local apps, services and environments.
outline: deep
---

<script setup>
import { onMounted } from 'vue'

import { data as initialStarCounts } from '../data/count.data.ts'
import { getStarCount } from '../src/lib/star-count.ts'

const formatStarCount = (count) => (
  `<span class="muted">(</span><span> ☆ </span><span>${Math.round(count / 100) / 10}k</span><span> </span><span class="muted">)</span>`
)

const renderStarCount = async (repoName, initialStarCount) => {
  const links = document.querySelectorAll(
    `.actions a[href="https://github.com/electric-sql/${repoName}"]`
  )
  links.forEach(async (link) => {
    link.innerHTML = '<span class="vpi-social-github"></span> GitHub&nbsp;'

    const countEl = document.createElement('span')
    countEl.classList.add('count')
    countEl.innerHTML = formatStarCount(initialStarCount)

    link.append(countEl)

    const count = await getStarCount(repoName, initialStarCount)
    countEl.innerHTML = formatStarCount(count)
  })
}

onMounted(async () => {
  if (typeof window !== 'undefined' && document.querySelector) {
    renderStarCount('electric', initialStarCounts.electric)
  }
})
</script>

<img src="/img/icons/electric.svg" class="product-icon" />

# Sync

Sync little subsets of your Postgres data into
local apps, services and environments.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="/docs/quickstart"
        text="Quickstart"
        theme="electric"
    />
  </div>
  <div class="action">
    <VPButton href="https://github.com/electric-sql/electric"
        text="GitHub"
        target="_blank"
        theme="alt"
    />
  </div>
</div>

## Electric sync engine

The Electric sync engine syncs [little subsets](/docs/guides/shapes) of data out of Postgres into local apps, services and environments &mdash; wherever you need the data.

<img srcset="/img/about/use-cases.sm.png 1098w, /img/about/use-cases.png 1484w"
    sizes="(max-width: 767px) 600px, 1484px"
    src="/img/about/use-cases.png"
    alt="Use cases diagramme"
/>

You can sync data into:

- web and mobile apps, [replacing data fetching with data sync](/use-cases/state-transfer)
- edge workers and services, for example maintaining a low-latency [edge data cache](/use-cases/cache-invalidation)
- local AI systems, for example [running RAG using pgvector](/use-cases/local-ai)
- dev and test environments, for example syncing data into [an embedded PGlite](/product/pglite) database

## How does it work?

The Electric sync engine is an [Elixir](https://elixir-lang.org) application, developed at [electric-sql/electric/tree/main/packages/sync-service](https://github.com/electric-sql/electric/tree/main/packages/sync-service).

It connects to your Postgres using a `DATABASE_URL`, consumes the logical replication stream and fans out data into [Shapes](/docs/guides/shapes), which [Clients](/docs/api/clients/typescript) then consume and sync.

<figure>
  <a href="/img/api/shape-log.jpg">
    <img srcset="/img/api/shape-log.sm.png 1064w, /img/api/shape-log.png 1396w"
        sizes="(max-width: 767px) 600px, 1396px"
        src="/img/api/shape-log.png"
        alt="Shape log flow diagramme"
    />
  </a>
  <figcaption class="figure-caption text-end">
    Shape log flow diagramme.
  </figcaption>
</figure>

This enables a massive number of clients to query and get real-time updates to subsets of the database. In this way, Electric turns Postgres into a real-time database.

## More information

See the [Docs](/docs/intro) and [Quickstart](/docs/quickstart) to get up-and-running with Electric sync. The source code is on GitHub at [electric-sql/electric](https://github.com/electric-sql/electric), including a list of [Examples](https://github.com/electric-sql/electric/tree/main/examples).

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="/docs/quickstart"
        text="Quickstart"
        theme="electric"
    />
  </div>
  <div class="action">
    <VPButton href="https://github.com/electric-sql/electric"
        text="Star on GitHub"
        target="_blank"
        theme="alt"
    />
  </div>
</div>