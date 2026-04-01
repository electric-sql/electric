---
title: 'Electric Cloud pricing is live'
description: >-
  Electric Cloud has self-serve pricing. Usage-based — pay for writes and retention. Reads, fan-out, and data delivery are free and unlimited.
excerpt: >-
  Electric Cloud now has self-serve pricing. Pay for writes and retention — reads and data delivery are free. Most simple apps will run for free on PAYG.
authors: [balegas]
image: /img/blog/electric-cloud-pricing/header.jpg
tags: [cloud, pricing]
outline: [2, 3]
post: true
published: true
---

Electric Cloud now has self-serve pricing. Sign up, pick a plan, start building — no sales call needed.

Pricing is usage-based: you pay for writes and retention. Data delivery — reads, fan-out, concurrent users — is free, unlimited, and always will be. The PAYG plan waives bills under $5/month, which is 5&nbsp;million writes per month for free. Most hobby and simple production apps will run for free&nbsp;forever.

:::info Key links
- [Sign up for Electric Cloud](https://dashboard.electric-sql.cloud)
- [Pricing details and calculator](/cloud/pricing)
- [Electric Cloud docs](/docs/intro)
:::

Electric Cloud has been running production workloads since the [public beta](/blog/2025/04/07/electric-cloud-public-beta-release), long enough to be confident in the platform's reliability and cost structure. We know many teams need to see published pricing before they commit. Now it's&nbsp;here.

## How pricing works

### The model

Two base billing dimensions: writes and retention.

- **$1 per million writes** to any stream. Each write is up to 10KB; larger messages auto-chunk and each chunk counts as a&nbsp;write.
- **$0.10 per GB-month** retention.
- **No charge** for reads, egress, fan-out, concurrent users, connections, or data&nbsp;delivery.

Some services that run additional infrastructure have a service cost on top of the base write rate. [Postgres Sync](/products/postgres-sync) runs a dedicated replication engine to filter changes and match them to shapes. This has an additional cost of $2 per million writes emitted to the shape log. You're charged for the filtered output, not the raw replication input — one Postgres change landing on 100 shapes =&nbsp;100&nbsp;writes.

See the [pricing page](/cloud/pricing) for the full breakdown and worked&nbsp;examples.

### The tiers

- **PAYG** — $0/month. No commitment, no credit card required. Bills under $5/month&nbsp;waived.
- **Pro** — $249/month (6-month commitment). 10% usage discount. Monthly fee acts as prepaid usage credit — you're not paying twice. Unlocks advanced features including hosted sub-queries for Postgres Sync and premium&nbsp;support.
- **Scale** — $1,999/month (12-month commitment). 20% usage discount. Same prepaid credit model. Direct access to founders and hands-on support to accelerate your time to&nbsp;market.

All tiers include unlimited reads and&nbsp;delivery.

### Why reads are free

Electric delivers data through CDN infrastructure. Caching and request-collapsing handle concurrency at the edge, so reads don't hit&nbsp;origin.

Your costs scale with your writes, not with your users or traffic. A stream with 10 readers costs the same as one with&nbsp;10,000.

## What it costs in practice

### AI chat app with token streams

Assumptions: 1,000 MAU, ~30 conversations per user per month, AI responses streamed as ~50 writes each (~500 tokens chunked at ~10 tokens per&nbsp;write).

- Writes: 1,000 &times; 30 &times; 50 = **1.5M writes/month**
- Retention: ~1GB of stream history &rarr; $0.10
- **Total: ~$1.60/month &rarr; waived on PAYG**

At 10,000 MAU that's ~15M writes, $15/month. At 100,000 MAU, ~150M writes. On Pro with the 10% discount, $135/month, covered by the $249 prepaid&nbsp;credit.

All the users *reading* those streams cost nothing. 100 users or 100,000 users on the same stream, same&nbsp;price.

### Real-time SaaS dashboard with Postgres Sync

Assumptions: 500 active users on a project management-style dashboard, syncing a handful of shapes&nbsp;each.

- Initial shape loads are served from the CDN cache after the first request — reads are&nbsp;free.
- Database changes: 50,000 row changes/month, average change matches 10 shapes = 500,000 emitted&nbsp;writes.
- Replication cost: 500K writes &times; $3/M ($1 base + $2 Postgres Sync) = $1.50
- Shape log writes from initial queries (~2K rows per shape across 500 users): ~1M rows &rarr; $1.00
- Retention: ~2GB &rarr; $0.20
- **Total: ~$2.70/month &rarr; waived on PAYG**

You're only charged for what gets emitted after filtering — a change that matches zero shapes costs&nbsp;nothing.

## Get started

Sign up at [Electric Cloud](https://dashboard.electric-sql.cloud). Start on PAYG, free below $5, no credit card required. See all the details on the [pricing page](/cloud/pricing), including a calculator to model your&nbsp;workload.

Already on Electric Cloud? You'll receive an email when billing is enabled for your&nbsp;workspace.

***

- [Sign up for Electric Cloud](https://dashboard.electric-sql.cloud)
- [Pricing calculator](/cloud/pricing#calculator)
- [Electric Cloud docs](/docs/intro)
