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

This page documents the config options for [self-hosting](/docs/guides/deployment) the [Electric sync engine](/products/postgres-sync).

> [!Warning] Advanced only
> You don't need to worry about this if you're using [Electric Cloud](/cloud).
>
> Also, the only required configuration options are `DATABASE_URL` and `ELECTRIC_SECRET`.

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

### ELECTRIC_POOLED_DATABASE_URL

<EnvVarConfig
    name="ELECTRIC_POOLED_DATABASE_URL"
    defaultValue="DATABASE_URL"
    example="postgresql://user:password@example-pooled.com:54321/electric">

Postgres connection string. Used to connect to the Postgres database for anything but the replication, will default to the same as `DATABASE_URL` if not provided.

The connection string must be in the [libpg Connection URI format](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING-URIS) of `postgresql://[userspec@][hostspec][/dbname][?sslmode=<sslmode>]`.

The `userspec` section of the connection string specifies the database user that Electric connects to Postgres as. This can point to a connection pooler and does not need a `REPLICATION` role as it does not handle the replication.

This should point to the same instance as the main database URL, as Electric relies on transaction information for consistency reasons.

For a secure connection, set the `sslmode` query parameter to `require`.

This used to be called `ELECTRIC_QUERY_DATABASE_URL`, but that name is deprecated and will be removed in a future release.

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

### ELECTRIC_DATABASE_CA_CERTIFICATE_FILE

<EnvVarConfig
    name="ELECTRIC_DATABASE_CA_CERTIFICATE_FILE"
    optional="true"
    example="/root/.postgresql/root.crt">

The path on local disk to a file containing trusted certificate(s) that Electric will use to verify the database server identity.

Trusted certificates are those that have been signed by trusted certificate authorities (CA); they are also known as root certificates. Every operating system and most web browsers include a bundle of well-known root certificates (aka CA store). You can instruct Electric to use the default bundle provided by your OS by specifying an absolute path to it. [This page](https://neon.com/docs/connect/connect-securely#location-of-system-root-certificates) from Neon lists the typical locations for different operating systems.

Some managed Postgres providers such as Supabase and DigitalOcean use a self-signed root certificate that won't be found in OS-specific CA stores. If you're using one of those, download the trusted certificate from the provider's website and put it somewhere on your local disk where Electric can access it.

**Certificate verification and `sslmode`**

Electric doesn't support `sslmode=verify-ca` or `sslmode=verify-full` query params in `DATABASE_URL`. Those values are specific to `psql`. When you configure Electric with a trusted certificate file, it will always try to verify the server identity and will refuse to open a database connection if the verification does not succeed.

Note, however, that setting `sslmode=disable` in `DATABASE_URL` and enabling certificate verification at the same time will result in a startup error.

</EnvVarConfig>

### ELECTRIC_REPLICATION_STREAM_ID

<EnvVarConfig
    name="ELECTRIC_REPLICATION_STREAM_ID"
    defaultValue="default"
    example="my-app">

Suffix for the logical replication publication and slot name.

</EnvVarConfig>

### ELECTRIC_REPLICATION_IDLE_TIMEOUT

<EnvVarConfig
    name="ELECTRIC_REPLICATION_IDLE_TIMEOUT"
    defaultValue="0"
    example="5min">

After seeing no activity on the logical replication stream for this long, Electric will close all of its database connections. This allows the database server to scale-to-zero on supported providers.

While Electric is in the scaled-down mode, an incoming shape request will cause it to reopen database connections and restart the logical replication stream. The request itself will be held until it can be processed as usual to return a proper response.

The default value is 0, meaning the connection scaling down is disabled and Electric will keep its database connections open permanently.

**Important note on WAL growth**

Avoid setting this timeout if your database sees constant or frequent writes.

When Electric isn't streaming from the database, its replication slot is inactive. Postgres will continue to retain WAL files needed for the slot, since they are required to resume replication later. Over time, this can cause storage growth proportional to the volume of writes on the primary database, regardless of whether those writes target tables for which Electric has active shapes or not.

Once Electric reconnects and replication catches up, Postgres will automatically discard the no-longer-needed WAL segments. However, if the inactivity period is too long, the accumulated WAL may exceed available disk space, potentially interrupting database operations.

</EnvVarConfig>

### ELECTRIC_MANUAL_TABLE_PUBLISHING

<EnvVarConfig
    name="ELECTRIC_MANUAL_TABLE_PUBLISHING"
    defaultValue="false"
    example="true">

Set to `true` to disable automatic addition/removal of database tables from the publication in Postgres.

In order to receive realtime updates as soon as they are committed in Postgres, Electric maintains a [publication](https://www.postgresql.org/docs/current/logical-replication-publication.html) inside the database and automatically adds tables to it for which shape subscriptions are established. This only works if Electric's database role owns the table or is granted the [group role](https://www.postgresql.org/docs/current/role-membership.html#ROLE-MEMBERSHIP) that owns the table.

If your permissions policies prevent Electric from using a role that can alter application tables, set this setting to `true` and manually add each table to the publication by executing

```sql
BEGIN;
ALTER PUBLICATION electric_publication_default ADD TABLE <my table>;
ALTER TABLE <my table> REPLICA IDENTITY FULL;
COMMIT;
```

before requesting a new shape for that table.

</EnvVarConfig>

## Electric

### ELECTRIC_SECRET

<EnvVarConfig
    name="ELECTRIC_SECRET"
    required={true}
    example="1U6ItbhoQb4kGUU5wXBLbxvNf">

Secret for shape requests to the [HTTP API](/docs/api/http). This is required unless `ELECTRIC_INSECURE` is set to `true`.
By default, the Electric API is public and authorises all shape requests against this secret.
More details are available in the [security guide](/docs/guides/security).

</EnvVarConfig>

### ELECTRIC_INSECURE

<EnvVarConfig
    name="ELECTRIC_INSECURE"
    defaultValue="false"
    example="true">

When set to `true`, runs Electric in insecure mode and does not require an `ELECTRIC_SECRET`.
Use with caution.
API requests are unprotected and may risk exposing your database.
Good for development environments.
If used in production, make sure to [lock down access](/docs/guides/security#network-security) to Electric.

</EnvVarConfig>

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

Name of the electric service. Used as a resource name in OTEL traces and metrics.

</EnvVarConfig>

### ELECTRIC_LISTEN_ON_IPV6

<EnvVarConfig
    name="ELECTRIC_LISTEN_ON_IPV6"
    defaultValue="false"
    example="true">

By default, Electric binds to IPv4. Enable this to listen on IPv6 addresses as well.

</EnvVarConfig>

### ELECTRIC_TCP_SEND_TIMEOUT

<EnvVarConfig
    name="ELECTRIC_TCP_SEND_TIMEOUT"
    defaultValue="30s"
    example="60s">
Timeout for sending a response chunk back to the client. Defaults to 30 seconds.

Slow response processing on the client or bandwidth restristrictions can cause TCP backpressure leading to the error message:

```
Error while streaming response: :timeout
```

This environment variable increases this timeout.

</EnvVarConfig>

### ELECTRIC_SHAPE_CHUNK_BYTES_THRESHOLD

<EnvVarConfig
    name="ELECTRIC_SHAPE_CHUNK_BYTES_THRESHOLD"
    defaultValue="10485760"
    example="20971520">

Limit the maximum size of a shape log response, to ensure they are cached by
upstream caches. Defaults to 10MB (10 _ 1024 _ 1024).

See [#1581](https://github.com/electric-sql/electric/issues/1581) for context.

</EnvVarConfig>

### ELECTRIC_PORT

<EnvVarConfig
    name="ELECTRIC_PORT"
    defaultValue="3000"
    example="8080">

Port that the [HTTP API](/docs/api/http) is exposed on.

</EnvVarConfig>

### ELECTRIC_SHAPE_SUSPEND_CONSUMER

<EnvVarConfig
    name="ELECTRIC_SHAPE_SUSPEND_CONSUMER"
    defaultValue="false"
    example="true">

Whether to terminate idle shape consumer processes after `ELECTRIC_SHAPE_HIBERNATE_AFTER` seconds. This saves on memory at the cost of slightly higher CPU usage. When receiving a transaction that contains changes matching a given shape, a consumer process is started to handle the update. If more transactions matching the shape appear within the time defined by `ELECTRIC_SHAPE_HIBERNATE_AFTER` then the consumer will remain active, if not it will be terminated.

If set to `false` the consumer processes will [hibernate](https://www.erlang.org/doc/apps/erts/erlang#hibernate/3) instead of terminating, meaning they still occupy some memory but are inactive until passed transaction operations to process.

If you enable this feature then you should configure `ELECTRIC_SHAPE_HIBERNATE_AFTER` to match the usage patterns of your application to avoid unnecessary process churn.

</EnvVarConfig>

### ELECTRIC_SHAPE_HIBERNATE_AFTER

<EnvVarConfig
    name="ELECTRIC_SHAPE_HIBERNATE_AFTER"
    defaultValue="30s"
    example="5000ms">

The amount of time a consumer process remains active without receiving transaction operations before either [hibernating](https://www.erlang.org/doc/apps/erts/erlang#hibernate/3) or terminating (if `ELECTRIC_SHAPE_SUSPEND_CONSUMER` is `true`).

</EnvVarConfig>

### ELECTRIC_SHAPE_DB_EXCLUSIVE_MODE

<EnvVarConfig
    name="ELECTRIC_SHAPE_DB_EXCLUSIVE_MODE"
    defaultValue="false"
    example="true">

Run the SQLite database holding active shape data over a single read-write connection, rather than a single writer and multiple reader connections. This avoids corruption issues when holding shape data on an NFS share (such as [AWS EFS](https://aws.amazon.com/efs/)). Set this to `true` and `ELECTRIC_SHAPE_DB_STORAGE_DIR=:memory:` to use an in-memory database.

</EnvVarConfig>

### ELECTRIC_SHAPE_DB_STORAGE_DIR

<EnvVarConfig
    name="ELECTRIC_SHAPE_DB_STORAGE_DIR"
    defaultValue="$ELECTRIC_STORAGE_DIR"
    example="/var/db/electric">

The base path for the shapes SQLite database. Set this to a local, non-networked drive, for consistency and performance reasons when hosting shape data on a network volume, such as [AWS EFS](https://aws.amazon.com/efs/). This is an alternative to `ELECTRIC_SHAPE_DB_EXCLUSIVE_MODE` when a single read-write connection does not provide enough performance. Note that if the `ELECTRIC_SHAPE_DB_STORAGE_DIR` is ephemeral, e.g. instance specific, then on a re-deployment the shape log data in `$ELECTRIC_STORAGE_DIR` (hosted on EFS) will be ignored by the system, which will start empty.

Enable `ELECTRIC_SHAPE_DB_EXCLUSIVE_MODE` and set `ELECTRIC_SHAPE_DB_EXCLUSIVE_MODE=:memory:` to use an ephemeral in-memory shape database.

</EnvVarConfig>

### ELECTRIC_SHAPE_DB_SYNCHRONOUS

<EnvVarConfig
    name="ELECTRIC_SHAPE_DB_SYNCHRONOUS"
    defaultValue="OFF"
    example="NORMAL">

The value of the [`synchronous` PRAGMA](https://sqlite.org/pragma.html#pragma_synchronous) set on every connection to the shape db.


</EnvVarConfig>

### ELECTRIC_SHAPE_DB_CACHE_SIZE

<EnvVarConfig
    name="ELECTRIC_SHAPE_DB_CACHE_SIZE"
    defaultValue="4096KiB"
    example="8MiB">

The value of the [`cache_size` PRAGMA](https://sqlite.org/pragma.html#pragma_cache_size) set on every connection to the shape db. Higher values will result in more memory usage but improved performance. Accepts values in bytes, or with a suffix such as "1024KB", "500KiB", "5MB", "8MiB", etc.

</EnvVarConfig>

## Feature Flags

Feature flags enable experimental or advanced features that are not yet enabled by default in production.

### ELECTRIC_FEATURE_FLAGS

<EnvVarConfig
    name="ELECTRIC_FEATURE_FLAGS"
    defaultValue=""
    example="allow_subqueries,tagged_subqueries">

**Available flags:**

- `allow_subqueries` - Enables subquery support in shape WHERE clauses
- `tagged_subqueries` - Enables improved multi-level dependency handling

</EnvVarConfig>

### allow_subqueries

Enables support for subqueries in the WHERE clause of [shape](/docs/guides/shapes) definitions. When enabled, you can use queries in the form:

```sql
WHERE id IN (SELECT user_id FROM memberships WHERE org_id = 'org_123')
```

This allows creating shapes that filter based on related data in other tables, enabling more complex data synchronization patterns.

**Status:** Experimental. Disabled by default in production.

### tagged_subqueries

Subqueries create dependency trees between shapes. Without this flag, when data moves into or out of a dependent shape, the shape is invalidated (returning a 409). With this flag enabled, move operations are handled correctly without invalidation.

See [discussion #2931](https://github.com/electric-sql/electric/discussions/2931) for more details about this feature.

**Status:** Experimental. Disabled by default in production. Requires `allow_subqueries` to be enabled.

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
    defaultValue="FAST_FILE"
    example="MEMORY">

Where to store shape logs. Defaults to storing on the filesystem.
If provided must be one of `MEMORY` or `FAST_FILE`.

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

### SENTRY_DSN

<EnvVarConfig
    name="SENTRY_DSN"
    optional="true"
    example="https://key@o0.ingest.sentry.io/0">

Set a [Sentry](https://sentry.io) DSN to enable error tracking via the Sentry Elixir SDK. When configured, Electric will automatically capture errors and report them to your Sentry project.

This requires Electric to be built with telemetry enabled (which is the case for the official Docker images).

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

### ELECTRIC_LOG_COLORS

<EnvVarConfig
    name="ELECTRIC_LOG_COLORS"
    optional="true"
    example="false">

Enable or disable ANSI coloring of Electric's log output.

By default, coloring is enabled when Electric's stdout is connected to a terminal. This may be undesirable in certain runtime environments, such as AWS which displays ANSI color codes using escape sequences and may incorrectly split log entries into multiple lines.

</EnvVarConfig>

### ELECTRIC_LOG_OTP_REPORTS

<EnvVarConfig
    name="ELECTRIC_LOG_OTP_REPORTS"
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
