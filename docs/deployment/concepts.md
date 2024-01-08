---
title: Concepts
description: >-
  The ingredients of a successful ElectricSQL deployment.
sidebar_position: 5
---

# The ingredients of a successful deployment

Each ElectricSQL deployment has three main components: your Postgres database, the Electric sync service and your local-first app. The sync service also provides a migration proxy and the `electric-sql` client library provides a generator script and proxy tunnel.

[![Overview of deployment components](../deployment/_images/components.png)](../deployment/_images/components.jpg)

The following section describes these components and their requirements in turn. The next section then describes [how to connect them](#connections).

## Components

### Postgres

ElectricSQL works on top of a Postgres database. Postgres is the source of durability in the system. It's the source of the shared DDL schema and the DDLX rules.

The requirements for Postgres are detailed on the [installation page](../usage/installation/postgres.md). You need logical replication enabled and a db user with sufficient privileges.

### Electric

ElectricSQL provides the [Electric sync service](../api/service.md). This is a web application that manages active-active replication between Postgres and your local app. The sync service is developed in [Elixir](https://elixir-lang.org). It can run anywhere you can deploy Elixir or Docker. It exposes at least a single HTTP port. This port provides both an HTTP API and a websocket API for the [Satellite replication protocol](../api/satellite.md).

The sync service also provides interfaces on two optional TCP ports:

1. the [logical publisher](#1-electric---postgres) for writing data into Postgres using logical replication
2. the [migrations proxy](#2-migrations---proxy) for applying DDL migrations

These are discussed in the [Connections](#connections) section below.

### App

Together, Postgres and Electric form the backend of your application, typically running in the cloud. The front-end of your application is a local app that you develop using the [`electric-sql` client library](../api/clients/typescript.md). This can be a [web app](../integrations/drivers/web/wa-sqlite.md) running in the browser, or a [mobile](../integrations/drivers/mobile/expo.md) or desktop app.

Whatever your target environment, your app code typically needs to be built, bundled and deployed. This usually involves generating the [type safe client](../usage/installation/client.md) as part of your build process, which requires connecting to the Electric sync service, as [discussed below](#3-generator---electric).

### Generator

The generator is built into the [`electric-sql` Typescript library](../usage/installation/client.md) and is invoked as the [`npx electric-sql generate` command](../api/cli.md#generate) that you call in development and during your build process to generate a [type safe client library](../usage/installation/client.md).

The generator needs to be able to connect to the Electric sync service and outputs a Typescript module that's imported and bundled into your app.

### Migrations proxy

The [migrations proxy](../usage/data-modelling/migrations.md#migrations-proxy) is a TCP service exposed by the Electric sync service. It supports the Postgres connection protocol and proxies interactive Postgres sessions applying migrations to your Postgres database.

Some application hosting services do not support external TCP ports. In this case, you can [use a proxy tunnel](#22-using-a-proxy-tunnel) to connect to the migrations proxy via the Electric sync service HTTP port.

## Connections

Having introduced the components of an ElectricSQL deployment above, we now discuss how to connect them. There are four main connections:

1. [Electric <-> Postgres](#1-electric---postgres) &mdash; the Electric sync service needs to connect to Postgres
2. [Migrations <-> Proxy](#2-migrations---proxy) &mdash; your migrations tooling needs to connect to the Migrations proxy
3. [Generator <-> Electric](#3-generator---electric) &mdash; the Generator needs to connect to the Electric sync service
4. [App <-> Electric](#4-app---electric) &mdash; your local-first app needs to connect to the Electric sync service

### 1. Electric <-> Postgres

Electric connects to Postgres using a `DATABASE_URL` connection string. In addition, it optionally provides a logical replication publisher service.

Electric actually connects to Postgres in three ways:

1. it uses a normal interactive client connection to bootstrap resources and make database queries (for example, when you subscribe to a [Shape](../usage/data-access/shapes.md), Electric uses the interactive connection to query for all the rows in the shape)
2. it establishes a logical replication subscription to consume changes from Postgres
3. it writes changes to Postgres that it receives from clients over the [Satellite replication protocol](../api/satellite.md)

This last one, writes changes to Postgres, can be done in two ways:

- you can set `ELECTRIC_WRITE_TO_PG_MODE=direct_writes` to write data to Postgres using a normal interactive client connection
- you can set `ELECTRIC_WRITE_TO_PG_MODE=logical_replication` to stream data into Postgres using a logical replication publication

Direct writes mode works out of the box and is the easiest mode to configure, with no additional network connectivity required. Logical replication mode requires exposing a TCP host and port to Postgres, so that Postgres can establish a logical replication subscription. This can be configured using the `LOGICAL_PUBLISHER_HOST` and `LOGICAL_PUBLISHER_PORT` env vars.

See <DocPageLink path="api/service" /> for more information.

### 2. Migrations <-> Proxy

Your migrations tooling should apply DDL migrations to Postgres via the [Migrations proxy](../usage/data-modelling/migrations.md#migrations-proxy). The Migrations proxy speaks the Postgres protocol and is exposed by the Electric sync service.

There are two ways to connect to it:

1. [as a TCP service](#21-as-a-tcp-service)
2. [using a Proxy tunnel](#22-using-a-proxy-tunnel)

#### 2.1 As a TCP service

If you can expose a TCP port to your Electric instance, you can connect to the proxy over it.

[![Connecting to the migrations proxy over a TCP port](../deployment/_images/tcp-port.png)](../deployment/_images/tcp-port.jpg)

The port exposed is configured using the `PG_PROXY_PORT` environment variable. For example, if your Electric service is running on `example.com` with `PG_PROXY_PORT=65432`, then you can connect using:

```
postgresql://${user}:${password}@example.com:65432/electric
```

Where `user` and `password` are the credentials to use to connect to your Postgres and `electric` is a default database name used for the proxy connection. When the connection is proxied onto your Postgres, Electric will use the host, port and dbname configured in the `DATABASE_URL` used to connect Electric to Postgres.

:::note
Some migrations tooling requires special handling by the Migrations proxy. See the specific [backend integration docs](../integrations/backend/index.md) for more information.
:::

#### 2.2 Using a Proxy tunnel

If your application host doesn't support exposing multiple ports, or doesn't support exposing a TCP port to the public Internet (this is true of many hosting services optimised for running HTTP services) then you can use a Proxy tunnel to connect to the Migrations proxy over HTTP.

[![Connecting to the migrations proxy using a Proxy tunnel](../deployment/_images/proxy-tunnel.png)](../deployment/_images/proxy-tunnel.jpg)

This works by running a CLI command provided by the `electric-sql` library to expose a TCP port on your local network. You then connect your migrations tooling to this local service and it connects to Electric using a TCP-over-HTTP tunnel:

For example to expose a tunnel to the Migrations proxy using the Electric sync service HTTP port, where the sync service is running on host `example.com`, port `5133`:

```shell
npx electric-sql proxy-tunnel \
    --service https://example.com:5133 \
    --local-port 65431
```

Then to apply migrations, connect to `localhost:65431`, e.g. using [@databases/pg-migrations](https://www.atdatabases.org/docs/pg-migrations):

```shell
pg-migrations apply \
    --database postgres://${user}:${password}@localhost:65431/electric \
    --directory ./db/migrations
```

### 3. Generator <-> Electric

When you build a local-first app with ElectricSQL, you [use the CLI `generate` command](../api/cli.md#generate) provided by the [Typescript client](../usage/installation/client.md) to generate a type-safe, schema-aware data access library and bundle this into your app.

When you *deploy* you app, you typically want to setup your CI or build environment to run the generate command as part of your production build process. This currently requires providing both `--service` and `--proxy` connection URLs, typically configured in your build environment using environment variables.

```shell
npx electric-sql generate \
    --service $ELECTRIC_URL \
    --proxy $MIGRATIONS_PROXY_URL
```

See <DocPageLink path="api/cli#generate" /> for more details.

### 4. App <-> Electric

Your app connects to the Electric sync service in order to sync data on and off the local device. Sync is established automatically when you electrify your local database connection.

The location of the sync service to connect to is configured using `config.url`. For example, for [wa-sqlite](../integrations/drivers/web/wa-sqlite.md) in the web browser:

```tsx
import { ElectricDatabase, electrify } from 'electric-sql/wa-sqlite'
import { schema } from './generated/client'

const config = {
  url: "https://example.com:5133",
  auth: {
    token: '...'
  }
}

const init = async () => {
  const conn = await ElectricDatabase.init('my.db', '/')

  return electrify(conn, schema, config)
}
```

See the configuration docs at <DocPageLink path="api/clients/typescript#configuration" /> for more details.

## Next steps

Hopefully that gives you a good sense of the components of an ElectricSQL deployment and how to wire them up.

[![Components and connections](../deployment/_images/components-and-connections.png)](../deployment/_images/components-and-connections.jpg)

See the [deployment guides](../top-level-listings/deployment.md#deployment-options) for more information about deploying to specific platforms.
