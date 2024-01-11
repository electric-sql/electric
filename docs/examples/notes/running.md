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
- you don't already have a publication called `electric_publication`
- you have a database user with [adequate permissions](../../usage/installation/service.md#permissions) for your write mode -- the simplest being `SUPERUSER`

### Connecting Electric to Postgres

The Electric sync service connects to Postgres using the `DATABASE_URL` environment variable. Depending on your choice of write mode, Postgres may also need to connect to Electric to consume a logical replication publication.

This is configured using the `LOGICAL_PUBLISHER_HOST` (and `LOGICAL_PUBLISHER_PORT`) environment variables:

```
         |<--------DATABASE_URL----------|
Postgres |                               | Electric
         |-----LOGICAL_PUBLISHER_HOST--->|
```

See <DocPageLink path="api/service" /> for more information.
