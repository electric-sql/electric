---
title: 'Electric BETA release'
description: >-
  The Electric sync engine is now in BETA.
  If you haven't checked out Electric recently,
  it's a great time to take another look.
excerpt: >-
  With version 1.0.0-beta.1, the Electric sync engine is now in BETA!
  If you haven't checked out Electric recently, it's a
  great time to take another look.
authors: [kyle]
image: /img/blog/electric-beta-release/header.jpg
tags: [release, postgres-sync]
outline: [2, 3]
post: true
homepage: false
---

<script setup>
  import LogoStrip from '/static/img/blog/electric-beta-release/logo-strip.svg'
  import LogoStripSm from '/static/img/blog/electric-beta-release/logo-strip.sm.svg'
  import LogoStripXs from '/static/img/blog/electric-beta-release/logo-strip.xs.svg'
  import LogoStripXxs from '/static/img/blog/electric-beta-release/logo-strip.xxs.svg'
  import LinearLiteScreenshot from '/static/img/blog/electric-beta-release/linearlite-screenshot.png'
  import ScalabilityChart from '../../src/components/ScalabilityChart.vue'

  import { onMounted } from 'vue'

  import { data as demosData } from '../../data/demos.data.ts'
  const { demos } = demosData

  const notesDemo = demos.find(x => x.link === '/demos/notes')
  const pixelArtDemo = demos.find(x => x.link === '/demos/pixel-art')

  onMounted(async () => {
    if (typeof window !== 'undefined' && document.querySelector) {
      let links = document.querySelectorAll('.cloud-cta a.VPButton.brand')

      links.forEach((link) => {
        if (link.querySelector('span.vpi-electric-icon')) {
          return
        }

        const icon = document.createElement('span')
        icon.classList.add('vpi-electric-icon')

        link.prepend(icon)
      })
    }
  })
</script>

With version [`1.0.0-beta.1`](https://github.com/electric-sql/electric/releases) the Electric sync engine is now in BETA!

If you haven't checked out Electric recently, it's a great time to [take another look](/docs/intro).

## What is Electric?

[Electric](/products/postgres-sync) is a Postgres sync engine. We do real-time [partial replication](/docs/guides/shapes) of Postgres data into local apps and services.

Use Electric to swap out data _fetching_ for [data _sync_](/sync). Build apps on instant, real-time, local data. Without having to roll your own sync engine or change your stack.

We also develop [PGlite](/products/pglite), a lightweight WASM Postgres you can run in the browser.

## The path to BETA

Six months ago, we [took on a clean re-write](/blog/2024/07/17/electric-next).

[First commit](https://github.com/electric-sql/archived-electric-next/commit/fc406d77caca923d1fb595d921102f25c7ce3856) was on the 29th June 2024. [600 pull requests later](https://github.com/electric-sql/electric/pulls?q=is%3Apr+is%3Aclosed), we're ready for adoption into production apps.

## Production ready

<figure>
  <img :src="LogoStrip" class="hidden-sm" />
  <img :src="LogoStripSm" class="hidden-xs block-sm" />
  <img :src="LogoStripXs" class="hidden-xxs block-xs" />
  <img :src="LogoStripXxs" class="block-xxs" />
</figure>

Electric and PGlite are being used in production by companies including [Google](https://firebase.google.com/docs/data-connect), [Supabase](https://database.build), [Trigger.dev](https://trigger.dev/launchweek/0/realtime), [Otto](https://ottogrid.ai) and [Doorboost](https://www.doorboost.com).

> We use ElectricSQL to power [Trigger.dev Realtime](https://trigger.dev/launchweek/0/realtime), a core feature of our product. When we execute our users background tasks they get instant updates in their web apps. It's simple to operate since we already use Postgres, and it scales to millions of updates per day.<br /> > _&mdash; [Matt Aitken](https://www.linkedin.com/in/mattaitken1985), Founder &amp; CEO, [Trigger.dev](https://trigger.dev)_

> At [Otto](https://ottogrid.ai), we built a spreadsheet product where every cell operates as its own AI agent. ElectricSQL enables us to reliably stream agent updates to our spreadsheet in real-time and efficiently manage large spreadsheets at scale. It has dramatically simplified our architecture while delivering the performance we need for cell-level reactive updates.<br /> > _&mdash; [Sully Omar](https://x.com/SullyOmarr), Co-founder &amp; CEO, [Otto](https://ottogrid.ai)_

> At [Doorboost](https://www.doorboost.com) we aggregate millions of rows from a dozen platforms, all of which gets distilled down to a simple dashboard. With Electric we have been able to deliver this dashboard in milliseconds and update live. Moving forward, we will be building all our products using Electric.<br /> > _&mdash; [Vache Asatryan](https://am.linkedin.com/in/vacheasatryan), CTO, [Doorboost](https://doorboost.com)_

### Scalable

So many real-time sync systems demo well but break under real load.

Electric has been [engineered from the ground up](/docs/api/http) to handle high-throughput workloads, like [Trigger.dev](https://trigger.dev/launchweek/0/realtime), with low latency and flat resource use. You can stream real-time data to **millions of concurrent users** from a single commodity Postgres.

The chart below is from our [cloud benchmarks](/docs/reference/benchmarks#cloud), testing Electric's memory usage and latency with a single Electric service scaling real-time sync from 100k to 1 million concurrent clients under a sustained load of 960 writes/minute. Both memory usage and latency are essentially <em>flat</em>:

<figure>
  <ScalabilityChart />
</figure>

You can also see how large-scale apps built with Electric feel to use with our updated [ Linearlite](/demos/linearlite) demo. This is a [Linear](https://linear.app) clone that loads 100,000k issues and their comments through Electric into PGlite (~150mb of data). Once loaded, it's fully interactive and feels instant to use:

<figure>
  <p>
    <a href="https://linearlite.examples.electric-sql.com" target="_blank">
      <img :src="LinearLiteScreenshot" />
    </a>
  </p>
  <figcaption>
    Screenshot of Linearlite.
    <a href="https://linearlite.examples.electric-sql.com" target="_blank">
      Open the demo</a>
  </figcaption>
</figure>

## Easy to adopt

We've iterated a lot on our APIs to make them as simple and powerful as possible. There should be no breaking changes in minor or patch releases moving forward.

We've updated our [Documentation](/docs/intro), with a new [Quickstart](/docs/quickstart) and guides for topics like:

- how to do [auth](/docs/guides/auth)
- how to handle [local writes](/docs/guides/writes)
- how to do [partial replication with Shapes](/docs/guides/shapes)
- how to [deploy Electric](/docs/guides/deployment)
- how to [write your own client](/docs/guides/client-development) for any language or environment

We have [client libraries](/docs/api/clients/typescript), [integration docs](/docs/integrations/react), [demo apps](/demos) and [technical examples](/demos#technical-examples) showing how to use Electric with different patterns and frameworks:

#### Interactive demos

<div class="demos-grid">
  <DemoListing :demo="notesDemo" />
  <DemoListing :demo="pixelArtDemo" />
</div>

### Incrementally

You can adopt Electric one component and one route at a time. Wherever you have code doing something like this:

```tsx
import React, { useState, useEffect } from 'react'

const MyComponent = () => {
  const [items, setItems] = useState([])

  useEffect(() => {
    const fetchItems = async () => {
      const response = await fetch('https://api.example.com/v1/items')
      const data = await response.json()

      setItems(data)
    }

    fetchItems()
  }, [])

  return <List items={items} />
}
```

Swap it out for code like this (replacing the `fetch` in the `useEffect` with [`useShape`](/docs/integrations/react)):

```tsx
import { useShape } from '@electric-sql/react'

const MyComponent = () => {
  const { data: items } = useShape({
    url: 'https://electric.example.com/v1/shapes',
    params: {
      table: 'items',
    },
  })

  return <List items={items} />
}
```

This works with _any_ Postgres [data model and host](/docs/guides/deployment), any data type, extension and Postgres feature. Including [pgvector](https://github.com/pgvector/pgvector), [PostGIS](https://postgis.net), sequential IDs, unique constraints, etc. You don't have to change your data model or your migrations to use Electric.

### With your existing API

Because Electric syncs [over HTTP](/docs/api/http), you can use it together [with your existing API](/blog/2024/11/21/local-first-with-your-existing-api).

This allows you to handle concerns like [auth](/docs/guides/auth) and [writes](/docs/guides/writes) with your existing code and web service integrations. You don't need to codify your auth logic into database rules. You don't need to replace your API endpoints and middleware stack.

## Take another look

With this BETA release, Electric is stable and ready for prime time use. If you haven't checked it out recently, it's a great time to take another look.

<div class="actions cta-actions page-footer-actions left">
  <div class="action">
    <VPButton
        href="/docs/quickstart"
        text="Quickstart"
        theme="brand"
    />
  </div>
  <div class="action">
    <VPButton
        href="/docs/intro"
        text="Documentation"
        theme="alt"
    />
  </div>
</div>

### Signup for early access to Electric Cloud

We're also building [Electric Cloud](/cloud), which provides managed Electric hosting (for those that don't want to [host Electric themselves](/docs/guides/deployment)).

If you're interested in using Electric Cloud, you can sign up for early access here:

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
        href="/cloud/sign-up"
        text="Sign up "
        theme="brand"
    />
  </div>
</div>
