---
title: Telemetry
description: >-
  The telemetry approach for Electric, what data is collected and why.
---

ElectricSQL collects anonymous usage data and sends them to our telemetry service. This page documents the telemetry approach, what data is collected and how to opt-out.

## Why does ElectricSQL collect telemetry?

We collect telemetry to understand key usage metrics. Specifically, the key metrics are:

1. how many applications are using the Electric sync service
2. what volume of data are they're syncing

## Where is data collected from

Telemetry is only collected from the [Electric sync service](../api/service.md).

No telemetry data is collected from the Typescript client library, your local-first applications or your Postgres database. Telemetry is only collected server side in aggregated anonymised form from the Elixir sync service.

## When and how is telemetry data collected?

We collect an aggregated usage report once every 4 hours.

Technically, we use the standard Elixir [Telemetry](https://hexdocs.pm/telemetry/readme.html) system to collect usage metrics in memory within the Electric sync service. Once every four hours, these metrics are aggregated and POSTed as a JSON document to the https://checkpoint.electric-sql.com endpoint.

## What is collected?

We send a small (~1.5kb) aggregated report that contains information about:

- the Electric instance software and the environment its running in
- the number of clients and subscriptions that are connected
- the number of operations and transactions replicated

None of this information is personal or sensitive. The instance and environment data is used for debugging. The cluster and instance IDs are random identifiers used to group the data. The usage data is just aggregated numbers.

You can see a sample of the payload here:

```elixir
%{
  electric_version: "0.5.3-28-gf78187e",
  environment: %{
    arch: "x86_64-pc-linux-gnu",
    cores: 8,
    electric_cluster_uuid: "a1336abd-804c-4d0c-a06a-c73da6dd148e",
    electric_instance_id: "0d64597b-168b-45a2-ad64-a9baba55fd59",
    os: %{family: :unix, name: :linux},
    pg_version: "14.9",
    ram: 33363812352
  },
  resources: %{
    oldest_wal_time: ~U[2023-09-19 14:40:45.972021Z],
    uptime: 10,
    used_memory: %{
      max: 64262224,
      mean: 64262224.0,
      median: 64262224,
      min: 64262224,
      mode: 64262224
    },
    wal_cache_memory: 2520,
    wal_transactions: 2
  },
  usage: %{
    concurrent_clients: %{max: 0, mean: 0.0, median: 0.0, min: 0, mode: 0},
    distinct_clients: 0,
    distinct_users: 0,
    electrified_tables: 0,
    initial_syncs: 0,
    operations_from_pg: 1,
    operations_received_from_clients: 0,
    operations_sent_to_clients: 0,
    subscriptions_continued: 0,
    subscriptions_continued_per_client: %{
      max: 0,
      mean: 0,
      median: 0,
      min: 0,
      mode: nil
    },
    subscriptions_established: 0,
    subscriptions_included_tables: %{
      max: 0,
      mean: 0,
      median: 0,
      min: 0,
      mode: nil
    },
    subscriptions_rows_per_shape: %{
      max: 0,
      mean: 0,
      median: 0,
      min: 0,
      mode: nil
    },
    transactions_from_pg: 2,
    transactions_received_from_clients: 0,
    transactions_sent_to_clients: 0
  }
}
```

## How do I opt-out?

You can opt-out of telemetry data collection by setting the `ELECTRIC_TELEMETRY` environment variable to `disabled`. See the [Electric sync service](../api/service.md) configuration docs for more information.

## Why would I not opt-out?

It's extremely helpful to leave telemetry enabled:

1. it's useful for debugging if we need to support your deployment
2. it helps us evidence traction, which is crucial to resourcing ongoing development

If you can run with telemetry enabled, you're supporting ongoing development of the project.
