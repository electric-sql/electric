---
title: Pricing
description: Electric Cloud pricing and calculator
image: /img/meta/electric-cloud.jpg
outline: deep
---

<script setup>
import PricingCalculator from '../src/components/PricingCalculator.vue'
</script>

<img src="/img/icons/ddn.svg" class="product-icon" />

# Pricing

Electric Cloud has self-serve, usage-based pricing. You pay for writes and retention. Reads, fan-out, concurrent users, and data delivery are free, unlimited, and always will be.

:::info Quick summary
- **$1 per million writes** to any stream
- **$0.10 per GB-month** retention
- **$2 per million writes** extra for Postgres Sync writes emitted to the shape log
- **PAYG bills under $5/month are waived**
:::

## How pricing works

Electric prices the work that hits origin infrastructure, not the reads that get served back out through the CDN.

### Base billing dimensions

| Dimension | Price | Notes |
| --- | --- | --- |
| Writes | $1 per million writes | Each write is up to 10KB. Larger messages auto-chunk and each chunk counts as a write. |
| Retention | $0.10 per GB-month | Charged on retained stream history and shape log storage. |
| Reads and delivery | Free | No charge for reads, egress, fan-out, concurrent users, or data delivery. |

### Postgres Sync pricing

[Postgres Sync](/products/postgres-sync) runs dedicated replication and filtering infrastructure on top of the base write pipeline.

- Postgres Sync writes are billed at the normal **$1 per million writes** base rate.
- They also incur an additional **$2 per million writes** service charge.
- You are billed on the **filtered output** emitted to the shape log, not raw upstream database changes.

If one Postgres change matches 100 shapes, that counts as 100 emitted writes.

## Plans

All plans include unlimited reads and delivery.

| Plan | Monthly fee | Usage discount | Commitment | Notes |
| --- | --- | --- | --- | --- |
| PAYG | $0 | None | None | No credit card required. Bills under $5/month are waived. |
| Pro | $249 | 10% | 6 months | Monthly fee acts as prepaid usage credit. Includes hosted sub-queries for Postgres Sync and premium support. |
| Scale | $1,999 | 20% | 12 months | Monthly fee acts as prepaid usage credit. Includes direct access to founders and hands-on support. |

### What prepaid credit means

On Pro and Scale, the monthly fee is not added on top of your discounted usage. It is your included spend for the month.

- If your discounted usage is below the plan fee, the fee covers it.
- If your discounted usage is above the plan fee, you only pay the overage beyond that included credit.

## Calculator

<PricingCalculator />

## FAQ

### Why are reads free?

Electric serves data through CDN infrastructure, so concurrency and fan-out are handled at the edge rather than driving per-reader origin cost.

### What counts as a write?

Each write is up to 10KB. If a message is larger, it is chunked automatically and each chunk is billed as a write.

### Will small apps really stay free?

For many hobby and simple production apps, yes. On PAYG, monthly bills below $5 are waived, which means up to 5 million base writes per month can land at $0 before any retention or Postgres Sync surcharge pushes the total above that threshold.

## Contact

Questions about pricing or larger deployments? Ask on [Discord](https://discord.electric-sql.com) or email [support@electric-sql.com](mailto:support@electric-sql.com).
