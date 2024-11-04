---
title: Sync service
description: >-
  Configuration options for the Electric sync engine.
outline: deep
---

<script setup>
import EnvVarConfig from '../../src/components/EnvVarConfig.vue'
</script>

# Sync service configuration

This page documents the config options for [self-hosting](/docs/guides/deployment) the [Electric sync engine](/product/sync).

> [!Warning] Advanced only
> You don't need to worry about this if you're using [Electric Cloud](/product/cloud).
>
> Also, the only required configuration is `DATABASE_URL`.

## Configuration

The sync engine is an [Elixir](https://elixir-lang.org) application developed at [packages/sync-service](https://github.com/electric-sql/electric/tree/main/packages/sync-service) and published as a [Docker](https://docs.docker.com/get-started/docker-overview) image at [electricsql/electric](https://hub.docker.com/r/electricsql/electric).

Configuration options can be provided as environment variables, e.g.:

```shell
docker run \
    -e "DATABASE_URL=postgresql://..." \
    -e "DB_POOL_SIZE=10" \
    -p 3000:3000 \
    electricsql/electric
```

These are passed into the application via [config/runtime.exs](https://github.com/electric-sql/electric/blob/main/packages/sync-service/config/runtime.exs).

## Database

### DATABASE_URL

<EnvVarConfig
    name="DATABASE_URL"
    required={true}
    example="postgresql://user:password@example.com:54321/electric">

Postgres connection string. Used to connect to the Postgres database.

The connection string must be in the [libpg Connection URI format](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING-URIS) of `postgresql://[userspec@][hostspec][/dbname][?sslmode=<sslmode>]`.

The `userspec` section of the connection string specifies the database user that Electric connects to Postgres as. They must have the `REPLICATION` role.

For a secure connection, set the `sslmode` query parameter to `require`.

</EnvVarConfig>

### DATABASE_USE_IPV6

<EnvVarConfig
    name="DATABASE_USE_IPV6"
    defaultValue="false"
    example="true">

Set to `true` to prioritise connecting to the database over IPv6. Electric will fall back to an IPv4 DNS lookup if the IPv6 lookup fails.

</EnvVarConfig>

### DB_POOL_SIZE

<EnvVarConfig
    name="DB_POOL_SIZE"
    defaultValue="20"
    example="10">

How many connections Electric opens as a pool for handling shape queries.

</EnvVarConfig>

### REPLICATION_STREAM_ID

<EnvVarConfig
    name="REPLICATION_STREAM_ID"
    defaultValue="default"
    example="my-app">

Suffix for the logical replication publication and slot name.

</EnvVarConfig>

## Electric

### ELECTRIC_INSTANCE_ID

<EnvVarConfig
    name="ELECTRIC_INSTANCE_ID"
    defaultValue="Electric.Utils.uuid4()"
    example="some-unique-instance-identifier">

A unique identifier for the Electric instance. Defaults to a randomly generated UUID.

</EnvVarConfig>

### ELECTRIC_SERVICE_NAME

<EnvVarConfig
    name="ELECTRIC_SERVICE_NAME"
    defaultValue="electric"
    example="my-electric-service">

Name of the electric service. Used as a resource identifier and namespace.

</EnvVarConfig>

### ENABLE_INTEGRATION_TESTING

<EnvVarConfig
    name="ENABLE_INTEGRATION_TESTING"
    defaultValue="false"
    example="true">

Expose some unsafe operations that faciliate integration testing.
Do not enable this production.

</EnvVarConfig>

### LISTEN_ON_IPV6

<EnvVarConfig
    name="LISTEN_ON_IPV6"
    defaultValue="false"
    example="true">

By default, Electric binds to IPv4. Enable this to listen on IPv6 addresses as well.

</EnvVarConfig>

### LOG_CHUNK_BYTES_THRESHOLD

<EnvVarConfig
    name="LOG_CHUNK_BYTES_THRESHOLD"
    defaultValue="10485760"
    example="20971520">

Limit the maximum size of a shape log response, to ensure they are cached by
upstream caches. Defaults to 10MB (10 * 1024 * 1024). See [#1581](https://github.com/electric-sql/electric/issues/1581) for context.

</EnvVarConfig>

### LOG_OTP_REPORTS

<EnvVarConfig
    name="LOG_OTP_REPORTS"
    defaultValue="false"
    example="true">

Enable [OTP SASL](https://www.erlang.org/doc/apps/sasl/sasl_app.html) reporting at runtime.

</EnvVarConfig>

### PORT

<EnvVarConfig
    name="PORT"
    defaultValue="3000"
    example="8080">

Port that the [HTTP API](/docs/api/http) is exposed on.

</EnvVarConfig>

## Caching

### CACHE_MAX_AGE

<EnvVarConfig
    name="CACHE_MAX_AGE"
    defaultValue="60"
    example="5">

Default `max-age` for the cache headers of the HTTP API.

</EnvVarConfig>

### CACHE_STALE_AGE

<EnvVarConfig
    name="CACHE_STALE_AGE"
    defaultValue="300"
    example="5">

Default `stale-age` for the cache headers of the HTTP API.

</EnvVarConfig>

## Storage

### PERSISTENT_STATE

<EnvVarConfig
    name="PERSISTENT_STATE"
    defaultValue="FILE"
    example="MEMORY">

Where to store shape metadata. Defaults to storing on the filesystem.
If provided must be one of `MEMORY` or `FILE`.

</EnvVarConfig>

### STORAGE

<EnvVarConfig
    name="STORAGE"
    defaultValue="FILE"
    example="MEMORY">

Where to store shape logs. Defaults to storing on the filesystem.
If provided must be one of `MEMORY` or `FILE`.

</EnvVarConfig>

### STORAGE_DIR

<EnvVarConfig
    name="STORAGE_DIR"
    defaultValue="./persistent"
    example="/var/example">

Path to root folder for storing data on the filesystem.

</EnvVarConfig>

## Telemetry

### OTLP_ENDPOINT

<EnvVarConfig
    name="OTLP_ENDPOINT"
    optional="true"
    example="https://example.com">

Set an [OpenTelemetry](https://opentelemetry.io/docs/what-is-opentelemetry/) endpoint URL
to enable telemetry.

</EnvVarConfig>

### OTEL_DEBUG

<EnvVarConfig
    name="OTEL_DEBUG"
    defaultValue="false"
    example="true">

Debug tracing by printing spans to stdout, without batching.

</EnvVarConfig>

### HNY_API_KEY

<EnvVarConfig
    name="HNY_API_KEY"
    optional="true"
    example="your-api-key">

[Honeycomb.io](https://www.honeycomb.io) api key. Specify along with `HNY_DATASET` to
export traces directly to Honeycomb, without the need to run an OpenTelemetry Collector.

</EnvVarConfig>

### HNY_DATASET

<EnvVarConfig
    name="HNY_DATASET"
    optional="true"
    example="your-dataset-name">

Name of your Honeycomb Dataset.

</EnvVarConfig>

### PROMETHEUS_PORT

<EnvVarConfig
    name="PROMETHEUS_PORT"
    optional="true"
    example="9090">

Expose a prometheus reporter for telemetry data on the specified port.

</EnvVarConfig>

### STATSD_HOST

<EnvVarConfig
    name="STATSD_HOST"
    optional="true"
    example="https://example.com">

Enable sending telemetry data to a StatsD reporting endpoint.

</EnvVarConfig>
