---
title: Documentation
description: >-
  Welcome to the ElectricSQL developer documentation!
outline: deep
---

<script setup>
import { data as demosData } from '../data/demos.data.ts'
const { demos } = demosData

const linearlite = demos.find(x => x.link === '/demos/linearlite')
const notes = demos.find(x => x.link === '/demos/notes')
</script>

<p class="intro-zap-container">
  <img src="/img/home/zap-with-halo.svg"
      alt="Electric zap with halo"
      class="intro-zap"
  />
</p>

# Documentation

Welcome to the ElectricSQL developer documentation!

ElectricSQL is a Postgres sync engine. Use it to sync [little subsets](/docs/guides/shapes) of your Postgres data into [local apps](/use-cases/data-sync), services and [environments](/use-cases/dev-and-test).

> [!Tip] Electric BETA release
> The Electric sync engine is now in BETA! See the [release post here](/blog/2024/12/10/electric-beta-release).

## New to ElectricSQL?

Start with the [Quickstart](/docs/quickstart) to get up-and-running. The guides on [Auth](/docs/guides/auth), [Shapes](/docs/guides/shapes) and [Writes](/docs/guides/writes) are also good entrypoints and helpful to understand how Electric works.

The [HTTP API](/docs/api/http) and [TypeScript Client](/docs/api/clients/typescript) docs show how to sync data. The [React](/docs/integrations/react) page illustrates how to bind these into a reactivity framework.

The easiest way to use Electric in production is the [Electric Cloud](/product/cloud). Alternatively, the [Deployment](/docs/guides/deployment) guide covers how to self host.

> [!warning] Looking for PGlite docs?
> If you're interested in using [PGlite](/product/pglite), it has it's own docs site at [pglite.dev/docs](https://pglite.dev/docs)

## Examples

See the [Demos](/demos) section and [`examples`](https://github.com/electric-sql/electric/tree/main/examples) folder on GitHub for demo apps and examples, e.g.:

<div class="demos-grid">
  <DemoListing :demo="linearlite"/>
  <DemoListing :demo="notes"/>
</div>

The integration docs also illustrate common patterns, e.g. using Electric with frameworks like [TanStack](/docs/integrations/tanstack) and [Phoenix](/docs/integrations/phoenix) and platforms like [Supabase](/docs/integrations/supabase) and [Cloudflare](/docs/integrations/cloudflare).

## Source code

ElectricSQL is an open source project developed at [github.com/electric-sql](https://github.com/electric-sql). Check out the source code, issues and development in progress there.

## Support

See the [Community page](/about/community) for information on support and events, including our [community Discord](https://discord.electric-sql.com) where you can ask questions and get support.
