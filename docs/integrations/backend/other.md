---
title: Other
description: >-
  Integrate with your framework of choice ...
sidebar_position: 80
---

ElectricSQL is designed to work with [any Postgres-backed system](../../usage/installation/postgres.md). You don't need a backend framework to use Electric.

## Migrations

You can use any migrations framework that supports executing arbitrary SQL. This includes executing [raw SQL statements](./sql.md).

See the other framework examples in this section for pointers.

:::caution Migrations proxy
Migrations should be applied via the migrations proxy as detailed in the [migrations guide](../../usage/data-modelling/migrations.md#migrations-proxy).
:::

:::note
If you don't have a data model already and you're looking for a tool to define and manage your Postgres database schema, we recommend [using Prisma](./prisma.md).
:::

## Event sourcing

There are lots of ways of consuming and responding to data change events with Postgres. See <DocPageLink path="integrations/event-sourcing" /> for more information.

:::note
If you're looking for a web framework that works well with realtime data processing and event sourcing, we recommend [Phoenix](./phoenix.md).
:::
