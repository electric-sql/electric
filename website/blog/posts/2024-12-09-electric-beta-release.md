---
title: "Electric BETA release"
description: >-
  The Electric sync engine is now in public BETA.
  If you haven't checked out Electric recently,
  it's a great time to take another look.
excerpt: >-
  With version X, the Electric sync engine is now
  in public BETA! If you haven't checked out Electric
  recently, it's a great time to take another look.
authors: [kyle]
image: /img/blog/electric-beta-release/header.jpg
tags: [release]
outline: [2, 3]
post: true
---

<script setup>
  import LogoStrip from '/static/img/blog/electric-beta-release/logo-strip.svg'
  import LogoStripSm from '/static/img/blog/electric-beta-release/logo-strip.sm.svg'
  import LogoStripXs from '/static/img/blog/electric-beta-release/logo-strip.xs.svg'
  import LogoStripXxs from '/static/img/blog/electric-beta-release/logo-strip.xxs.svg'
  import LinearLiteScreenshot from '/static/img/blog/electric-beta-release/linearlite-screenshot.png'
  import ScalabilityChart from '../../src/components/ScalabilityChart.vue'

  import { onMounted } from 'vue'

  onMounted(async () => {
    if (typeof window !== 'undefined' && document.querySelector) {
      let links = document.querySelectorAll('.cloud-cta a.VPButton.brand')

      console.log('links', links)

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

With [version X](#) the Electric sync engine is now in public BETA!

If you haven't checked out Electric recently, it's a great time to [take another look](/docs/intro).

## What is Electric?

[Electric](/product/electric) is a Postgres sync engine. We sync [little subsets](/docs/guides/shapes) of your Postgres data into local apps and services.

Use Electric to swap out data fetching for [data sync](/use-cases/data-sync). Build apps on instant, real-time, local data. Without having to roll your own sync engine or change your stack.

We also develop [PGlite](/product/pglite), a lightweight WASM Postgres you can run in the browser.

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

> We use ElectricSQL to power [Trigger.dev Realtime](https://trigger.dev/launchweek/0/realtime), a core feature of our product. When we execute our users background tasks they get instant updates in their web apps. It's simple to operate since we already use Postgres, and it scales to millions of updates per day.<br />
> *&mdash; [Matt Aitken](https://www.linkedin.com/in/mattaitken1985), Founder &amp; CEO, [Trigger.dev](https://trigger.dev)*

> <br /><br />... quote coming ...<br /><br /><br />
> *&mdash; [Sully Omar](https://x.com/SullyOmarr), Co-founder &amp; CEO, [Otto](https://ottogrid.ai)*

> At [Doorboost](https://www.doorboost.com) we aggregate millions of rows from a dozen platforms, all of which gets distilled down to a simple dashboard. With Electric we have been able to deliver this dashboard in milliseconds and update live. Moving forward, we will be building all our products using Electric.<br />
> *&mdash; [Vache Asatryan](https://am.linkedin.com/in/vacheasatryan), Co-founder &amp; CTO, [Doorboost](https://doorboost.com)*

### Scalable

So many real-time sync systems demo well but break under real load.

Electric has been [engineered from the ground up](/docs/api/http) to handle high-throughput workloads, like [Trigger.dev](https://trigger.dev/launchweek/0/realtime), with low latency and flat resource use. You can stream real-time data to **millions of concurrent users** from a single commodity Postgres:

<figure>
  <ScalabilityChart />
</figure>

See our [Scaling a sync engine](#) post and [benchmarks](/docs/reference/benchmarks) page for more details.

You can also see how large-scale apps built with Electric feel to use with our updated [ Linearlite](https://linearlite.electric-sql.com) demo. This is a [Linear](https://linear.app) clone that loads 100,000 issues and 200,000 comments through Electric into PGlite. It loads fast, it feels instant and it's fully interactive:

<figure>
  <a href="https://linearlite.electric-sql.com" target="_blank">
    <img :src="LinearLiteScreenshot" />
  </a>
  <figcaption>
    Screenshot of Linearlite. Click on it to
    <a href="https://linearlite.electric-sql.com" target="_blank">
      open the demo</a>
  </figcaption>
</figure>

## Easy to adopt

Our APIs are now stable. There will be no breaking changes in minor or patch releases moving forward.

We have [updated docs](/docs/intro), with a new [Quickstart](/docs/quickstart) and guides for topics like:

- how to do [auth](/docs/guides/auth)
- how to handle [local writes](/docs/guides/writes)
- how to do [partial replication with Shapes](/docs/guides/shapes)
- how to [deploy Electric](/docs/guides/deployment)
- how to [write your own client](/docs/guides/client-development) for any language or environment

We have [client libraries](/docs/api/clients/typescript), [integration docs](/docs/integrations/react) and [examples](#) showing how to use Electric with different patterns and frameworks:

> <br /><br /><br /><br /><br />... grid of the best examples ...<br /><br /><br /><br /><br /><br />

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

  return (
    <List items="items" />
  )
}
```

Swap it out for code like this (replacing the `fetch` in the `useEffect` with [`useShape`](/docs/integrations/react)):

```tsx
import { useShape } from '@electric-sql/react'

const MyComponent = () => {
  const { data } = useShape({
    url: 'https://electric.example.com/v1/shapes',
    params: {
      table: 'items'
    }
  })

  return (
    <List items="data" />
  )
}
```

This works with *any* Postgres [data model and host](/docs/guides/deployment), any data type, extension and Postgres feature. Including [pgvector](https://github.com/pgvector/pgvector), [PostGIS](https://postgis.net), sequential IDs, unique constraints, etc. You don't have to change your data model or your migrations to use Electric.

### With your existing API

Because Electric syncs [over HTTP](/docs/api/http), you can use it together [with your existing API](#blog-post).

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

### Signup for cloud

We're also working hard building our [Cloud product](/product/cloud), which provides managed Electric hosting so you don't need to [host Electric yourself](/docs/guides/deployment).

If you're interested in using Electric Cloud, you can sign up for early access now:

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
        href="/product/cloud/sign-up"
        text="Sign up "
        theme="brand"
    />
  </div>
</div>