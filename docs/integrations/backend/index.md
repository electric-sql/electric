---
title: Backend
sidebar_position: 30
---

import DocCardList from '@theme/DocCardList'

:::caution Limitations
See <DocPageLink path="usage/data-modelling" /> for current limitations on data modelling and migrations.
:::

ElectricSQL is designed to work with [any Postgres-backed system](../../usage/installation/postgres.md). You don't need a specific ([or, in fact, any](./other.md)) backend framework to use Electric.

However, it's common to manage the Postgres data model using a migrations system. These are often provided by your web framework. Because ElectricSQL's [DDLX Rules](../../api/ddlx.md) are applied using DDL migrations, this section shows you how to do this using some popular frameworks.

:::note
Some frameworks also provide or work with Postgres change data capture tooling, such as logical replication consumers. This can be useful for [Event sourcing](../event-sourcing/index.md).
:::

<DocCardList />
