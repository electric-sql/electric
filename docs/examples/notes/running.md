---
title: Running the examples
description: Notes on how to run the ElectricSQL examples.
---

Source code for the example applications is in [electric-sql/electric/examples](https://github.com/electric-sql/electric/tree/main/examples). Each application has a `README.md` that you can follow, with the primary steps as follows:

Install dependencies:

```shell
yarn
```

Run the backend services ([Postgres](../../usage/installation/postgres.md) + [Electric](../../usage/installation/service.md)):

```shell
yarn backend:start
```

Apply database [migrations](../../usage/data-modelling/migrations.md):

```shell
yarn db:migrate
```

Use the database schema to generate your [type-safe Client](../../usage/data-access/client.md):

```shell
yarn client:generate
```

(Or `yarn client:watch` to monitor for database schema changes and auto-generate the client whenever the schema changes.)

Start the app:

```shell
yarn start
```

## Running your own Postgres

`yarn backend:start` uses Docker Compose to start a connected Postgres and Electric. To run the Electric sync service on top of an *existing* Postgres instead, make sure that:

- your Postgres is up and running and configured with `wal_level = 'logical'`
- you don't already have a publication called `postgres_1`
- you have a database user with [adequate permissions](../../usage/installation/postgres.md#permissions) -- the simplest being `SUPERUSER`

### Running the sync service

Instead of `yarn backend:start`, run:

```shell
DATABASE_URL="postgresql://..." yarn electric:start
```

Setting the `DATABASE_URL` value to the connection string to your database, in the format `postgresql://user:pass@host:port/database`. This database URL will be used by the Electric service that runs within Docker to connect to your Postgres database.

:::note
If your Postgres database runs on the host machine, you may need to provide `host.docker.internal` as the hostname.
:::

Then, prefix the `db:migrate` command with the same `DATABASE_URL`:

```shell
DATABASE_URL="postgresql://..." yarn db:migrate
```

:::note
Note that this time, the database URL is used by the migration script (not running in Docker), so there's no need to use `host.docker.internal`.
:::

### Postgres <-> Electric interactions

The Electric sync service connects to Postgres using the `DATABASE_URL` environment variable. Postgres connects to Electric to consume a logical replication publication using the `LOGICAL_PUBLISHER_HOST` (and `LOGICAL_PUBLISHER_PORT`) environment variables:

```
         |<--------DATABASE_URL----------|
Postgres |                               | Electric
         |-----LOGICAL_PUBLISHER_HOST--->|
```

With the `yarn electric:start` script, `LOGICAL_PUBLISHER_HOST` defaults to `localhost`. If your sync service is running on a different host, you may need to change this. Either by patching the `./backend/startElectric.js` script, or by just running the Electric sync service directly using the `docker run` command shown in <DocPageLink path="api/service" />.
