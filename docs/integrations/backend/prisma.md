---
title: Prisma
description: >-
  Next-generation Node.js and TypeScript ORM.
sidebar_position: 40
---

## Migrations

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
npx prisma migrate dev
```

## Generator

Electric uses a customised version of the [zod-prisma-types](https://github.com/chrishoermann/zod-prisma-types) Prisma client generator to [generate](../../api/generator.md) the [Electric Client](../../usage/data-access/client.md).

## Event sourcing

Prisma provides [Pulse](https://www.prisma.io/data-platform/pulse), a type-safe API for subscribing to database change events.
