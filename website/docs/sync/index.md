---
title: Electric Sync
titleTemplate: "... - Electric Sync"
description: >-
  Documentation for Electric Sync — the read-path sync engine for Postgres, syncing data into local clients over HTTP.
outline: deep
---

<script setup>
import { data as demosData } from '../../data/demos.data.ts'
const { demos } = demosData

const burn = demos.find(x => x.link === '/sync/demos/burn')
const linearlite = demos.find(x => x.link === '/sync/demos/linearlite')
</script>

<img src="/img/icons/docs.svg" class="product-icon"
    style="width: 72px"
/>

# Electric Sync

Electric Sync is a read-path sync engine for Postgres. It syncs data out of Postgres into local clients over HTTP using a primitive called a [Shape](/docs/sync/guides/shapes).

Use it to build [fast,&nbsp;modern&nbsp;apps](/blog/2025/07/29/super-fast-apps-on-sync-with-tanstack-db) and [<span class="no-wrap">multi-agent systems</span>](/blog/2026/01/12/durable-sessions-for-collaborative-ai) with&nbsp;Electric.

## Getting started

Start with the [Quickstart](/docs/sync/quickstart) for the fastest way to get up-and-running.

The easiest way to use Electric in production is the [Electric Cloud](/cloud). Alternatively, the [Deployment](/docs/sync/guides/deployment) guide covers how to self host.

- [Quickstart](/docs/sync/quickstart) — get a sync running end-to-end in a few minutes.
- [Stacks](/docs/sync/stacks) — recommended stacks for building local-first apps with Electric.

## Guides

- [Shapes](/docs/sync/guides/shapes) — defining what gets synced.
- [Auth](/docs/sync/guides/auth) — securing access to your shapes.
- [Writes](/docs/sync/guides/writes) — patterns for writing data back through your API.
- [Deployment](/docs/sync/guides/deployment) — how to self-host Electric.
- [Security](/docs/sync/guides/security) — securing your Electric deployment.
- [Client development](/docs/sync/guides/client-development) — building your own client library.

## Reference

- [HTTP API](/docs/sync/api/http) — the protocol that clients consume.
- [TypeScript client](/docs/sync/api/clients/typescript) — the official client library.
- [Configuration](/docs/sync/api/config) — server configuration options.
- [Integrations](/docs/sync/integrations/react) — framework, platform, and database integrations.

## Examples

See the [Demos](/sync/demos/) section and [`examples`](https://github.com/electric-sql/electric/tree/main/examples) folder on GitHub for demos and examples, e.g.:

<div class="demos-grid">
  <DemoListing :demo="burn"/>
  <DemoListing :demo="linearlite"/>
</div>

The integration docs also illustrate common patterns, e.g. using Electric with frameworks like [TanStack](/docs/sync/integrations/tanstack) and [Phoenix](/docs/sync/integrations/phoenix) and platforms like [Supabase](/docs/sync/integrations/supabase) and [Cloudflare](/docs/sync/integrations/cloudflare).

## See also

- [PGlite](/sync/pglite) — embeddable Postgres for the browser, Node.js, and edge.

## Source code

Electric is an open source project developed at [github.com/electric-sql](https://github.com/electric-sql). Check out the source code, issues and development in progress there.

## Support

See the [Community page](/about/community) for information on support and events, including our [community Discord](https://discord.electric-sql.com) where you can ask questions and get support.
