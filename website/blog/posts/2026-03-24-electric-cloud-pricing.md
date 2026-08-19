---
title: '...'
description: >-
  ...
excerpt: >-
  ...
authors: [balegas]
image: /img/blog/electric-cloud-pricing/header.jpg
tags: [cloud, pricing]
outline: [2, 3]
post: true
published: false
---

<!-- TLDR: State what shipped and the key benefit immediately. No setup.
     The reader should know in 10 seconds: pricing is live, it's usage-based,
     reads are free, and most simple apps run for free. -->

Electric Cloud now has self-serve pricing. Sign up, pick a plan, start building — no sales call needed.

Pricing is usage-based: you pay for writes and retention. Data delivery — reads, fan-out, concurrent users — is free, unlimited, and always will be. The PAYG plan waives bills under $5/month — that's 5&nbsp;million writes per month for free. Most hobby and simple production apps will run for free&nbsp;forever.

:::info Key links
- [Sign up for Electric Cloud](https://dashboard.electric-sql.cloud)
- [Pricing details and calculator](/pricing)
- [Electric Cloud docs](/docs)
:::

## Context

<!-- Context: Brief orientation. Cloud has been battle-tested, platform has
     expanded, and pricing signals the maturity that professional teams need
     to commit. -->

Electric Cloud has been running production workloads for months — long enough to be confident in the platform's reliability and cost structure. Cloud has evolved from a managed Postgres sync engine into a broader real-time data platform built on [durable streams](/products/durable-streams).

We know many professional teams need to see published pricing before they commit to a platform. Now it's here.

## How pricing works

<!-- What's shipping: The meat of the post. Lead with the model, then the
     tiers, then the "why reads are free" explanation. Concrete numbers
     throughout. Keep it honest and straightforward. -->

### The model

Two base billing dimensions: writes and retention.

- **$1 per million writes** to any stream. Each write is up to 10KB; larger messages auto-chunk.
- **$0.10 per GB-month** retention.
- **No charge** for reads, egress, fan-out, concurrent users, connections, or data&nbsp;delivery.

Some services that run additional infrastructure have a service cost on top of the base write rate. [Postgres Sync](/products/postgres-sync) runs a dedicated replication engine to filter changes and match them to shapes. This has an additional cost of $2 per million writes emitted to the shape log. You're charged for the filtered output, not the raw replication input — one Postgres change landing on 100 shapes&nbsp;=&nbsp;100&nbsp;writes.

See the [pricing page](/pricing) for the full breakdown and worked&nbsp;examples.

### The tiers

<!-- Tiers: Lead with what each tier gives you. Monthly fees act as prepaid
     usage credits — make sure this lands clearly. -->

- **PAYG** — $0/month. No commitment, no credit card upfront. Bills under $5/month waived.
- **Pro** — $249/month (6-month commitment). 10% usage discount. Monthly fee acts as prepaid usage credit — you're not paying twice. Unlocks advanced features including hosted sub-queries for Postgres Sync and premium&nbsp;support.
- **Scale** — $1,999/month (12-month commitment). 20% usage discount. Same prepaid credit model. Direct access to founders and hands-on support to accelerate your time to&nbsp;market.

All tiers include unlimited reads and&nbsp;delivery.

### Why reads are free

<!-- Explain the architectural reason this isn't just marketing. CDN caching
     and request-collapsing mean reads genuinely don't cost us proportionally. -->

Electric delivers data through existing CDN infrastructure. Caching and request-collapsing handle concurrency at the edge — reads don't hit origin.

Your costs scale with your writes — the data going in — not with your users or traffic. A stream with 10 readers costs the same as one with&nbsp;10,000.

## What it costs in practice

<!-- Two worked scenarios. Real numbers, honest assumptions. The pricing is
     genuinely cheap, so let the numbers speak. -->

### AI chat app with token streams

<!-- Scenario: Durable streams only, base rate. Show that a real AI app runs
     cheap on PAYG, and that all the users reading streams cost nothing. -->

Assumptions: 1,000 MAU, ~30 conversations per user per month, AI responses streamed as ~50 writes each (~500 tokens chunked at ~10 tokens per&nbsp;write).

- Writes: 1,000 &times; 30 &times; 50 = **1.5M writes/month**
- Retention: ~1GB of stream history → $0.10
- **Total: ~$1.60/month → waived on PAYG**

At 10,000 MAU that's ~15M writes, $15/month. At 100,000 MAU, ~150M writes — on Pro with the 10% discount, $135/month, covered by the $249 prepaid&nbsp;credit.

All the users *reading* those streams cost nothing. 100 users or 100,000 users on the same stream — same&nbsp;price.

### Real-time SaaS dashboard with Postgres Sync

<!-- Scenario: Postgres Sync with base rate + $2/M service surcharge.
     Show that a structured SaaS app is also very cheap. -->

Assumptions: 500 active users on a project management-style dashboard, syncing a handful of shapes&nbsp;each.

- Initial shape loads are served from the CDN cache after the first request — reads are free.
- Database changes: 50,000 row changes/month, average change matches 10 shapes = 500,000 emitted writes.
- Replication cost: 500K writes &times; $3/M = $1.50
- Shape log writes from initial queries: ~1M rows → $1.00
- Retention: ~2GB → $0.20
- **Total: ~$2.70/month → waived on PAYG**

One Postgres change landing on 100 shapes = 100 writes — but you're only charged for what gets emitted after filtering, not the raw replication&nbsp;traffic.

## Get started

<!-- Get started: Short and actionable. -->

Sign up at [dashboard.electric-sql.cloud](https://dashboard.electric-sql.cloud) — start on PAYG, free below $5, no credit card required. See all the details on the [pricing page](/pricing), including a calculator to model your&nbsp;workload.

Already on Electric Cloud? You'll have received (or will receive) an email confirming when billing is enabled for your&nbsp;workspace.

***

- [Sign up for Electric Cloud](https://dashboard.electric-sql.cloud)
- [Pricing details and calculator](/pricing)

<!-- DELETE EVERYTHING BELOW THIS LINE BEFORE PUBLISHING -->
<!-- ===================================================== -->

<!--
## Intent

- **What is this post about?** Electric Cloud now has self-serve pricing.
- **What's interesting?** Developers want to know what it costs to run on
  Electric Cloud. Usage-based pricing with free reads/delivery is genuinely
  different and cheap.
- **Reader takeaway:** Electric Cloud has pricing live. They understand how it
  works. They believe it's cost-efficient — no egress charges, cheapest way
  to do data delivery into clients.
- **CTAs:** Sign up (dashboard), see pricing page.
- **Authority:** We are the founders of Electric. We build Cloud.

## Title brief

Sentence case. Straightforward, not clever. Communicate: pricing is live,
it's for Electric Cloud. Direction: "Electric Cloud pricing is live" or
"Pricing for Electric Cloud". Short.

## Description brief (SEO, no HTML, <160 chars)

Convey: Electric Cloud has self-serve pricing. Usage-based — pay for writes
and retention. Reads, fan-out, and data delivery are free and unlimited.

## Excerpt brief (blog listing card, max 3 short sentences)

Hit: pricing is live, usage-based with free delivery, most simple apps run
free on PAYG forever.

## Image prompt

Dark background. Concept: pricing / cost transparency, or the writes-in /
reads-free model. Brand colors: #D0BCFF (purple), #00d2a0 (green),
#75fbfd (cyan). 16:9 aspect ratio (~1536x950px), center-center composition.
Use /blog-image-brief for a detailed prompt.

## Pricing page brief: Postgres Sync cost breakdown

Capture these mechanics on the pricing page (FAQ or dedicated section):

**Base write rate:** $1/million writes to any durable stream (including
shape logs).

**Postgres Sync service surcharge:** Additional $2/million for writes
emitted through the Electric sync engine. This covers the replication
engine that processes logical replication data, filters changes, and
matches them to shapes for partial replication.

**What counts as a write for Postgres Sync:**
1. Initial shape query results — charged at $1/M rows (results are written
   to the shape log)
2. Subset query results — charged at $1/M (charged to relay results, even
   though not technically written to log)
3. Live replication data — charged on *emitted* writes (after filtering /
   matching to shapes), NOT ingested writes off the replication slot. One
   Postgres change hitting 100 shapes = 100 emitted writes.

**Effective rate for Postgres Sync replication writes:** $3/million
($1 base + $2 service surcharge) for writes emitted to the shape log
from logical replication.

**Key message:** You pay for the work the system does for you (filtering,
matching, delivering), not for raw throughput off your database.

## Asset checklist

- [ ] Header image (needs creating)
- [ ] Validate worked scenario assumptions (MAU, write counts)

## Typesetting checklist

- [ ] Non-breaking spaces and hyphens to avoid widows/orphans
- [ ] Title in sentence case
- [ ] Check title, image, and post at different screen widths
- [ ] No LLM tells

## Open questions

- Exact numbers for the two worked scenarios — are the MAU/write
  assumptions validated?
- Should the post link to a changelog or release notes for the billing
  system?
- Header image — use /blog-image-brief for a detailed prompt?
-->
