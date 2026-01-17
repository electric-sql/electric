---
title: Documentation
description: >-
  Welcome to the ElectricSQL developer documentation!
outline: deep
---

<script setup>
import { data as demosData } from '../data/demos.data.ts'
const { demos } = demosData

const burn = demos.find(x => x.link === '/demos/burn')
const linearlite = demos.find(x => x.link === '/demos/linearlite')
</script>

<p class="intro-zap-container">
  <img src="/img/home/zap-with-halo.svg"
      alt="Electric zap with halo"
      class="intro-zap"
  />
</p>

# Documentation

Welcome to the ElectricSQL developer documentation!

ElectricSQL is a Postgres sync engine. Use it to sync [subsets](/docs/guides/shapes) of your Postgres data into [local apps](/sync#fast-modern-apps), services and [environments](/docs/quickstart).

> [!Tip] 🔥 TanStack DB - now in BETA!
> [Introducing TanStack DB](/blog/2025/07/29/local-first-sync-with-tanstack-db) - a reactive client store for building super fast apps on sync!

## New to ElectricSQL?

Start with the [Quickstart](/docs/quickstart) to get up-and-running.

The [HTTP API](/docs/api/http) and [TypeScript Client](/docs/api/clients/typescript) docs and the guides on [Auth](/docs/guides/auth) and [Shapes](/docs/guides/shapes) are good entrypoints and helpful to understand how Electric works.

The [TanStack integration page](/docs/integrations/tanstack) then links to resources showing how to build super fast apps with Electric and TanStack DB.

The easiest way to use Electric in production is the [Electric Cloud](/cloud). Alternatively, the [Deployment](/docs/guides/deployment) guide covers how to self host.

> [!warning] Looking for other product docs?
> - **Durable Streams** docs are at [github.com/electric-sql/electric/tree/main/packages/durable-streams](https://github.com/electric-sql/electric/tree/main/packages/durable-streams)
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

ElectricSQL is an open source project developed at [github.com/electric-sql](https://github.com/electric-sql). Check out the source code, issues and development in progress there.

## Support

See the [Community page](/about/community) for information on support and events, including our [community Discord](https://discord.electric-sql.com) where you can ask questions and get support.
