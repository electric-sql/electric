---
title: Prisma
description: >-
  Next-generation Node.js and TypeScript ORM.
sidebar_position: 40
---

## Migrations

### Proxying

To run your migrations [through the proxy](../../usage/data-modelling/migrations.md#migrations-proxy) setup your `schema.prisma` to read the database URL from an environment variable:

```js
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

You can then use [dotenv-cli](https://www.npmjs.com/package/dotenv-cli) to setup multiple `.env` files. For example, create a `.env.proxy` with a database URL to connect to the proxy:

```shell
DATABASE_URL=postgresql://postgres:${PG_PROXY_PASSWORD}@localhost:${PG_PROXY_PORT}/mydb
```

And then run commands using this env file:

```shell
dotenv -e .env.proxy -- npx prisma migrate dev
```

Which you can wrap up into a package script, as per the Prisma docs for [Running migrations on different environments](https://www.prisma.io/docs/guides/development-environment/environment-variables/using-multiple-env-files#running-migrations-on-different-environments):

```json
  "scripts": {
    "migrate:postgres": "dotenv -e .env.proxy -- npx prisma migrate dev",
  },
```

### Applying DDLX statements

[Customize a migration to include an unsupported feature](https://www.prisma.io/docs/guides/migrate/developing-with-prisma-migrate/include-unsupported-database-features).

First, use the `--create-only` flag to generate a new migration without applying it:

```shell
npx prisma migrate dev --create-only
```

Open the generated migration.sql file and add the electrify call:

```sql
ALTER TABLE items ENABLE ELECTRIC;
```

Apply the migration:

```shell
dotenv -e .env.proxy -- npx prisma migrate dev
```

## Generator

Electric uses a customised version of the [zod-prisma-types](https://github.com/chrishoermann/zod-prisma-types) Prisma client generator to [generate](../../api/cli.md#generate) the [Electric Client](../../usage/data-access/client.md).

## Event sourcing

Prisma provides [Pulse](https://www.prisma.io/data-platform/pulse), a type-safe API for subscribing to database change events.
