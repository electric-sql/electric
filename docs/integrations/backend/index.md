---
title: Backend
sidebar_position: 30
---

import DocCardList from '@theme/DocCardList'

ElectricSQL is designed to work with [any Postgres-backed system](../../usage/installation/postgres.md). You don't need a specific ([or, in fact, any](./other.md)) backend framework to use Electric.

However, it's common to manage the Postgres data model using a migrations system. These are often provided by your web framework. Because ElectricSQL's [DDLX Rules](../../api/ddlx.md) are applied using DDL migrations, this section shows you how to do this using some popular frameworks.

:::caution Migrations proxy
Note that migrations should be applied via the migrations proxy as detailed in the [migrations guide](../../usage/data-modelling/migrations.md#migrations-proxy).

This often means using a different `DATABASE_URL` for your migrations scripts vs your main application.
:::

Some frameworks also provide or work with Postgres change data capture tooling, such as logical replication consumers. This can be useful for [Event sourcing](../event-sourcing/index.md).

<DocCardList />
