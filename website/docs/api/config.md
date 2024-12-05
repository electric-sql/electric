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

This page documents the config options for [self-hosting](/docs/guides/deployment) the [Electric sync engine](/product/electric).

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
    -e "ELECTRIC_DB_POOL_SIZE=10" \
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

### ELECTRIC_DATABASE_USE_IPV6

<EnvVarConfig
    name="ELECTRIC_DATABASE_USE_IPV6"
    defaultValue="false"
    example="true">

Set to `true` to prioritise connecting to the database over IPv6. Electric will fall back to an IPv4 DNS lookup if the IPv6 lookup fails.

</EnvVarConfig>

### ELECTRIC_DB_POOL_SIZE

<EnvVarConfig
    name="ELECTRIC_DB_POOL_SIZE"
    defaultValue="20"
    example="10">

How many connections Electric opens as a pool for handling shape queries.

</EnvVarConfig>

### ELECTRIC_REPLICATION_STREAM_ID

<EnvVarConfig
    name="ELECTRIC_REPLICATION_STREAM_ID"
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

### ELECTRIC_ENABLE_INTEGRATION_TESTING

<EnvVarConfig
    name="ELECTRIC_ENABLE_INTEGRATION_TESTING"
    defaultValue="false"
    example="true">

Expose some unsafe operations that faciliate integration testing.
Do not enable this production.

</EnvVarConfig>

### ELECTRIC_LISTEN_ON_IPV6

<EnvVarConfig
    name="ELECTRIC_LISTEN_ON_IPV6"
    defaultValue="false"
    example="true">

By default, Electric binds to IPv4. Enable this to listen on IPv6 addresses as well.

</EnvVarConfig>

### ELECTRIC_SHAPE_CHUNK_BYTES_THRESHOLD

<EnvVarConfig
    name="ELECTRIC_SHAPE_CHUNK_BYTES_THRESHOLD"
    defaultValue="10485760"
    example="20971520">

Limit the maximum size of a shape log response, to ensure they are cached by
upstream caches. Defaults to 10MB (10 * 1024 * 1024).

See [#1581](https://github.com/electric-sql/electric/issues/1581) for context.

</EnvVarConfig>

### ELECTRIC_PORT

<EnvVarConfig
    name="ELECTRIC_PORT"
    defaultValue="3000"
    example="8080">

Port that the [HTTP API](/docs/api/http) is exposed on.

</EnvVarConfig>

## Caching

### ELECTRIC_CACHE_MAX_AGE

<EnvVarConfig
    name="ELECTRIC_CACHE_MAX_AGE"
    defaultValue="60"
    example="5">

Default `max-age` for the cache headers of the HTTP API.

</EnvVarConfig>

### ELECTRIC_CACHE_STALE_AGE

<EnvVarConfig
    name="ELECTRIC_CACHE_STALE_AGE"
    defaultValue="300"
    example="5">

Default `stale-age` for the cache headers of the HTTP API.

</EnvVarConfig>

## Storage

### ELECTRIC_PERSISTENT_STATE

<EnvVarConfig
    name="ELECTRIC_PERSISTENT_STATE"
    defaultValue="FILE"
    example="MEMORY">

Where to store shape metadata. Defaults to storing on the filesystem.
If provided must be one of `MEMORY` or `FILE`.

</EnvVarConfig>

### ELECTRIC_STORAGE

<EnvVarConfig
    name="ELECTRIC_STORAGE"
    defaultValue="FILE"
    example="MEMORY">

Where to store shape logs. Defaults to storing on the filesystem.
If provided must be one of `MEMORY` or `FILE`.

</EnvVarConfig>

### ELECTRIC_STORAGE_DIR

<EnvVarConfig
    name="ELECTRIC_STORAGE_DIR"
    defaultValue="./persistent"
    example="/var/example">

Path to root folder for storing data on the filesystem.

</EnvVarConfig>

## Telemetry

These environment variables allow configuration of metric and trace export for visibility into performance of the Electric instance.

### ELECTRIC_OTLP_ENDPOINT

<EnvVarConfig
    name="ELECTRIC_OTLP_ENDPOINT"
    optional="true"
    example="https://example.com">

Set an [OpenTelemetry](https://opentelemetry.io/docs/what-is-opentelemetry/) endpoint URL
to enable telemetry.

</EnvVarConfig>

### ELECTRIC_OTEL_DEBUG

<EnvVarConfig
    name="ELECTRIC_OTEL_DEBUG"
    defaultValue="false"
    example="true">

Debug tracing by printing spans to stdout, without batching.

</EnvVarConfig>

### ELECTRIC_HNY_API_KEY

<EnvVarConfig
    name="ELECTRIC_HNY_API_KEY"
    optional="true"
    example="your-api-key">

[Honeycomb.io](https://www.honeycomb.io) api key. Specify along with `HNY_DATASET` to
export traces directly to Honeycomb, without the need to run an OpenTelemetry Collector.

</EnvVarConfig>

### ELECTRIC_HNY_DATASET

<EnvVarConfig
    name="ELECTRIC_HNY_DATASET"
    optional="true"
    example="your-dataset-name">

Name of your Honeycomb Dataset.

</EnvVarConfig>

### ELECTRIC_PROMETHEUS_PORT

<EnvVarConfig
    name="ELECTRIC_PROMETHEUS_PORT"
    optional="true"
    example="9090">

Expose a prometheus reporter for telemetry data on the specified port.

</EnvVarConfig>

### ELECTRIC_STATSD_HOST

<EnvVarConfig
    name="ELECTRIC_STATSD_HOST"
    optional="true"
    example="https://example.com">

Enable sending telemetry data to a StatsD reporting endpoint.

</EnvVarConfig>

## Logging

### ELECTRIC_LOG_LEVEL

<EnvVarConfig
    name="ELECTRIC_LOG_LEVEL"
    optional="true"
    example="debug">

Verbosity of Electric's log output.

Available levels, in the order of increasing verbosity:
- `error`
- `warning`
- `info`
- `debug`

</EnvVarConfig>

### ELECTRIC_LOGGING_COLORS

<EnvVarConfig
    name="ELECTRIC_LOGGING_COLORS"
    optional="true"
    example="false">

Enable or disable ANSI coloring of Electric's log output.

By default, coloring is enabled when Electric's stdout is connected to a terminal. This may be undesirable in certain runtime environments, such as AWS which displays ANSI color codes using escape sequences and may incorrectly split log entries into multiple lines.

</EnvVarConfig>

### ELECTRIC_LOGGING_OTP_REPORTS

<EnvVarConfig
    name="ELECTRIC_LOGGING_OTP_REPORTS"
    defaultValue="false"
    example="true">

Enable [OTP SASL](https://www.erlang.org/doc/apps/sasl/sasl_app.html) reporting at runtime.

</EnvVarConfig>


## Usage reporting

### ELECTRIC_USAGE_REPORTING

These environment variables allow configuration of anonymous usage data reporting back to https://electric-sql.com

<EnvVarConfig
    name="ELECTRIC_USAGE_REPORTING"
    defaultValue="true"
    example="true">

Configure anonymous usage data about the instance being sent to a central checkpoint service. Collected information is anonymised and doesn't contain any information from the replicated data. You can read more about it in our [telemetry docs](../reference/telemetry.md#anonymous-usage-data).

</EnvVarConfig>
