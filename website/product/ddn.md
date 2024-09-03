---
title: Data Delivery Network
description: >-
  Sync data faster than you can query Postgres.
  Scale out to millions of users.
outline: deep
---

<img src="/img/icons/ddn.svg" class="product-icon" />

# Data Delivery Network

Load data faster than you can query Postgres,
scale out to millions of users.

## Use cases

This allows you to scale out real-time data to millions of concurrent users from a single commodity Postgres. With blazing fast load times, minimal latency and low resource use.

<!-- graphs, evidence, benchmarks -->

## How does it work?

`electric` has been designed from the ground up to deliver fast initial data loads and low latency ongoing sync. It exposes this through an [HTTP API](/docs/api/http) that provides standard caching headers that work out-of-the-box with CDNs like Cloudflare and Fastly.

## How do I use it?

<!-- FIXME: add CDN integration guide -->

Run Electric and put it behind a CDN.

We will add more detailed guide and example content. For now, see the [sync-service/dev/nginx.conf](https://github.com/electric-sql/electric/blob/main/packages/sync-service/dev/nginx.conf) and [typescript-client/test/cache.test.ts](https://github.com/electric-sql/electric/blob/main/packages/typescript-client/test/cache.test.ts) for example usage.
