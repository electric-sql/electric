---
title: Protocols
description: Electric Cloud supported protocols
image: /img/meta/electric-cloud.jpg
outline: deep
---

<img src="/img/icons/ddn.svg" class="product-icon" />

# Protocols

Electric Cloud supports multiple sync protocols.

## HTTP Sync

Electric syncs data over HTTP. This allows it to integrate with CDN infrastructure.

See the [HTTP API reference](/docs/api/http) for details.

## Data Delivery Network

Electric Cloud leverages HTTP sync to provide a global Data Delivery Network.

This allows you to scale out real-time data to [millions of concurrent users](/docs/reference/benchmarks#cloud) from a single commodity Postgres. With fast load times, low latency and consistent, low resource use.

## Clients

Electric provides clients for consuming sync data:

- [TypeScript client](/docs/api/clients/typescript)
- [Elixir client](/docs/api/clients/elixir)

## Integrations

See our [integrations](/docs/integrations/react) for framework-specific guides.
