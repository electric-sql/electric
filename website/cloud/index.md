---
title: Cloud
description: >-
  Scalable data infrastructure platform for building fast, modern apps and collaborative multi-agent, multi-user AI apps and agentic systems.
image: /img/meta/electric-cloud.jpg
outline: deep
---

<style scoped>
  .cloud-header p {
    max-width: 360px
  }
  .data-source-icon {
    width: 2rem;
    display: inline;
    vertical-align: middle;
    margin-top: -4px;
  }
</style>

<div class="cloud-header">

<img src="/img/icons/ddn.svg" class="product-icon" />

# Electric Cloud

Scalable data infrastructure platform for fast, modern apps and
<span class="no-wrap">
  multi-agent</span>
systems.

<div class="cloud-cta">
  <VPButton
      href="https://dashboard.electric-sql.cloud/"
      text="Start building now »"
      theme="brand"
  />
</div>

</div>

## Scalable data infrastructure

Electric Cloud provides turnkey hosting of [Durable&nbsp;Streams](/products/durable-streams) and [Postgres&nbsp;Sync](/products/postgres-sync).

### <img src="/img/icons/durable-streams.svg" class="data-source-icon"> Durable&nbsp;Streams

We host [Durable&nbsp;Streams](/products/durable-streams) with [multiple protocols](./protocols), from raw binary streams, to JSON mode, to protocol specific transports and user-defined sync protocols using Durable State. See the [announcement blog post here](/blog/2026/01/22/announcing-hosted-durable-streams).

### <img src="/img/icons/electric.svg" class="data-source-icon"> Postgres&nbsp;Sync

We provision, run and operate the [Postgres sync engine](/products/postgres-sync) for you. This connects to your Postgres, consumes changes over logical replication and provides a service endpoint for [syncing shapes](/docs/guides/shapes) into your client.

## Data delivery network

Electric [syncs data over HTTP](/docs/api/http) via CDN infrastructure. Electric Cloud leverages this to provide a global Data Delivery Network.

This allows you to scale out real-time data to [millions of concurrent users](/docs/reference/benchmarks#cloud). With fast load times, low latency and consistent, low resource use.

## Next steps

Sign up and start building with Electric Cloud today.

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
        href="https://dashboard.electric-sql.cloud/"
        text="Start building now »"
        theme="brand"
    />
  </div>
</div>
