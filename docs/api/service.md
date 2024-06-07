---
title: Sync service
description: >-
  Runtime configuration options for the Electric sync service.
sidebar_position: 20
---

The Electric sync service is an Elixir application that manages [active-active replication](/docs/intro/active-active) between your Postgres database and your [local apps](/docs/intro/local-first).

[![Components and connections](../deployment/_images/components-and-connections.png)](../deployment/_images/components-and-connections.jpg)

The main way to run the sync service is using the [official Docker image](https://hub.docker.com/r/electricsql/electric). See <DocPageLink path="usage/installation/service" /> for more instructions.

Configuration options are passed as environment variables, e.g.:

```shell
docker run \
    -e "DATABASE_URL=postgresql://..." \
    -e "PG_PROXY_PASSWORD=..." \
    -e "AUTH_JWT_ALG=HS512" \
    -e "AUTH_JWT_KEY=..." \
    -p 5133:5133 \
    electricsql/electric
```

This page documents all the configuration options, including the:

- [core config](#core-config) of `DATABASE_URL`, `HTTP_PORT`, etc.
- [write-to-PG mode](#write-to-pg-mode) with associated networking and [database&nbsp;user&nbsp;permissions](#database-user-permissions)
- [migrations proxy](#migrations-proxy), [authentication](#authentication) and [telemetry](#telemetry)

:::info
For a longer form description of how to successfully deploy the sync service and what needs to connect where, see <DocPageLink path="deployment/concepts" />.
:::

:::caution A note on ports
Your configuration options affect the number and type of ports that need to be exposed. You must always expose the [`HTTP_PORT`](#http_port). Your [write-to-PG mode](#write-to-pg-mode) and [migrations proxy](#migrations-proxy) config then determines whether you need to expose up-to two TCP ports: the [`LOGICAL_PUBLISHER_PORT`](#logical_publisher_port) and [`PG_PROXY_PORT`](#pg_proxy_port) respectively.

In development using Docker you usually want to map all the necessary ports to your host network (`-p 5133:5133` in the example above).

In production you must make sure your hosting infrastructure exposes the necessary ports and protocols. If not, you can use the workarounds provided in the form of [direct writes mode](#direct-writes-mode) and the [proxy tunnel](#migrations-proxy).

Again, see <DocPageLink path="deployment/concepts" /> for more information.
:::

## Core config

import EnvVarConfig from '@site/src/components/EnvVarConfig'
import DatabaseRequireSsl from './_DATABASE_REQUIRE_SSL.md'
import DatabaseUrl from './_DATABASE_URL.md'
import DatabaseUseIpv6 from './_DATABASE_USE_IPV6.md'
import ElectricUseIpv6 from './_ELECTRIC_USE_IPV6.md'
import HttpPort from './_HTTP_PORT.md'
import ElectricResumableWalWindow from './_ELECTRIC_RESUMABLE_WAL_WINDOW.md'
import ElectricTxnCacheSize from './_ELECTRIC_TXN_CACHE_SIZE.md'
import LogLevel from './_LOG_LEVEL.md'


Configure how Electric connects to Postgres and exposes its HTTP/WebSocket API.

### DATABASE_URL

<EnvVarConfig
    name="DATABASE_URL"
    required={true}
    example="postgresql://user:password@example.com:54321/electric">
  <DatabaseUrl />
</EnvVarConfig>

### DATABASE_REQUIRE_SSL

<EnvVarConfig
    name="DATABASE_REQUIRE_SSL"
    defaultValue="true"
    example="false">
  <DatabaseRequireSsl />
</EnvVarConfig>

### DATABASE_USE_IPV6

<EnvVarConfig
    name="DATABASE_USE_IPV6"
    defaultValue="false"
    example="true">
  <DatabaseUseIpv6 />
</EnvVarConfig>

### ELECTRIC_USE_IPv6

<EnvVarConfig
    name="ELECTRIC_USE_IPV6"
    defaultValue="true"
    example="false">
  <ElectricUseIpv6 />
</EnvVarConfig>

### HTTP_PORT

<EnvVarConfig
    name="HTTP_PORT"
    defaultValue="5133"
    example="8080">
  <HttpPort />
</EnvVarConfig>

### ELECTRIC_RESUMABLE_WAL_WINDOW

<EnvVarConfig
    name="ELECTRIC_RESUMABLE_WAL_WINDOW"
    defaultValue="2G"
    example="800M">
  <ElectricResumableWalWindow />
</EnvVarConfig>

### ELECTRIC_TXN_CACHE_SIZE

<EnvVarConfig
    name="ELECTRIC_TXN_CACHE_SIZE"
    defaultValue="256M"
    example="2g">
  <ElectricTxnCacheSize />
</EnvVarConfig>

### LOG_LEVEL

<EnvVarConfig
    name="LOG_LEVEL"
    defaultValue="info"
    example="debug">
  <LogLevel />
</EnvVarConfig>

## Database user permissions

The Electric sync service connects to Postgres using the [`DATABASE_URL`](#database_url) connection string, in the format `postgresql://[userspec@][hostspec][/dbname]`.

The `userspec` section of this connection string specifies the database user that Electric connects to Postgres as. This user must have the following permissions.

### Permissions for logical replication mode

In [logical replication mode](#logical-replication-mode), the database user must have the [`LOGIN` and `SUPERUSER` role attributes](https://www.postgresql.org/docs/16/role-attributes.html#ROLE-ATTRIBUTES). You can create a user with these permissions using, e.g.:

```sql
CREATE ROLE electric
  WITH LOGIN
       PASSWORD '...'
       SUPERUSER;
```

### Permissions for direct writes mode

In [direct writes mode](#direct-writes-mode), the database user must have `LOGIN`, `REPLICATION` and then either `ALL` on the database and public schema or at a minimum:

- `CONNECT`, `CREATE` and `TEMPORARY` on the database
- `CREATE`, `EXECUTE on ALL` and `USAGE` on the `public` schema

Plus `ALTER DEFAULT PRIVILEGES` to grant the same permissions on any new tables in the public schema. For example, to create a user with the necessary permissions:

```sql
CREATE ROLE electric
  WITH LOGIN
    PASSWORD '...'
    REPLICATION;

GRANT ALL
  ON DATABASE '...'
  TO electric;

GRANT ALL
  ON ALL TABLES
  IN SCHEMA public
  TO electric;

ALTER DEFAULT PRIVILEGES
  IN SCHEMA public
  GRANT ALL
    ON TABLES
    TO electric;
```

## Migrations proxy

Electric exposes a [Migrations proxy](../usage/data-modelling/migrations.md#migrations-proxy) as a TCP service. This must be secured using `PG_PROXY_PASSWORD` and is exposed on `PG_PROXY_PORT`.

[![Connecting to the migrations proxy over a TCP port](../deployment/_images/tcp-port.png)](../deployment/_images/tcp-port.jpg)

The `PG_PROXY_PORT` supports a special `http` value that allows you to connect to the migrations proxy over a TCP-over-HTTP tunnel. This enables the use of the [Proxy Tunnel](./cli.md#proxy-tunnel). This is a CLI command that tunnels the Migrations proxy connection over the [`HTTP_PORT`](#http_port).

[![Connecting to the migrations proxy using a Proxy tunnel](../deployment/_images/proxy-tunnel.png)](../deployment/_images/proxy-tunnel.jpg)

import PgProxyPassword from './_PG_PROXY_PASSWORD.md'
import PgProxyPort from './_PG_PROXY_PORT.md'


#### PG_PROXY_PASSWORD

<EnvVarConfig
    name="PG_PROXY_PASSWORD"
    required={true}
    example="b3aed739144e859a">
  <PgProxyPassword />
</EnvVarConfig>

#### PG_PROXY_PORT

<EnvVarConfig
    name="PG_PROXY_PORT"
    defaultValue="65432"
    example="http:65432">
  <PgProxyPort />
</EnvVarConfig>

## Authentication

Electric provides two authentication modes:

1. [secure](#secure-mode) (the default)
2. [insecure](#insecure-mode)

In secure more, `AUTH_JWT_ALG` and `AUTH_JWT_KEY` are required. In insecure mode, all other authentication variables can be omitted.

import AuthMode from './_AUTH_MODE.md'
import AuthJwtNamespace from './_AUTH_JWT_NAMESPACE.md'


#### AUTH_MODE

<EnvVarConfig
    name="AUTH_MODE"
    defaultValue="secure"
    example="insecure">
  <AuthMode />
</EnvVarConfig>

#### AUTH_JWT_NAMESPACE

<EnvVarConfig
    name="AUTH_JWT_NAMESPACE"
    optional={true}
    example="example">
  <AuthJwtNamespace />
</EnvVarConfig>

### Secure mode

In secure mode, Electric authenticates its replication connections by obtaining a JWT from each client and verifying its validity before allowing data streaming in either direction.

See <DocPageLink path="usage/auth/secure" />

import AuthJwtAlg from './_AUTH_JWT_ALG.md'
import AuthJwtKey from './_AUTH_JWT_KEY.md'
import AuthJwtKeyIsBase64Encoded from './_AUTH_JWT_KEY_IS_BASE64_ENCODED.md'
import AuthJwtIss from './_AUTH_JWT_ISS.md'
import AuthJwtAud from './_AUTH_JWT_AUD.md'

#### AUTH_JWT_ALG

<EnvVarConfig
    name="AUTH_JWT_ALG"
    required={true}
    example="HS512">
  <AuthJwtAlg />
</EnvVarConfig>

#### AUTH_JWT_KEY

<EnvVarConfig
    name="AUTH_JWT_KEY"
    required={true}
    example="x\a0CA7Q4_gc...">
  <AuthJwtKey />
</EnvVarConfig>

#### AUTH_JWT_KEY_IS_BASE64_ENCODED

<EnvVarConfig
    name="AUTH_JWT_KEY_IS_BASE64_ENCODED"
    optional={true}
    example="true">
  <AuthJwtKeyIsBase64Encoded />
</EnvVarConfig>

#### AUTH_JWT_ISS

<EnvVarConfig
    name="AUTH_JWT_ISS"
    optional={true}
    example="example.com">
  <AuthJwtIss />
</EnvVarConfig>

#### AUTH_JWT_AUD

<EnvVarConfig
    name="AUTH_JWT_AUD"
    optional={true}
    example="example.com">
  <AuthJwtAud />
</EnvVarConfig>

### Insecure mode

Insecure mode is designed for development or testing. It supports unsigned JWTs that can be generated anywhere, including on the client, as well as signed JWTs which are accepted with no signature verification.

All other authentication variables (aside from `AUTH_MODE`) can be omitted.

See <DocPageLink path="usage/auth/insecure" /> for more information.

## Telemetry

By default, ElectricSQL collects aggregated, anonymous usage data and sends them to our telemetry service. See <DocPageLink path="reference/telemetry" /> for more information.

#### ELECTRIC_TELEMETRY

import ElectricTelemetry from './_ELECTRIC_TELEMETRY.md'


<EnvVarConfig
    name="ELECTRIC_TELEMETRY"
    defaultValue="enabled"
    example="disabled">
  <ElectricTelemetry />
</EnvVarConfig>
