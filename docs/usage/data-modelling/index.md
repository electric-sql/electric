---
title: Data modelling
sidebar_position: 20
---

import DocCardList from '@theme/DocCardList';

:::caution Limitations
ElectricSQL is still in [early stage development](../../reference/limitations.md). Known limitations include:

- [additive migrations](./migrations.md#additive-migrations) only
- limited [data types](./migrations.md#data-types)
- limited [constraints](./migrations.md#constraints)
- [DDLX rules](../../api/ddlx.md) limited to [electrification with function call syntax](../../reference/limitations.md#ddlx-rules)
:::

ElectricSQL syncs data between a [central Postgres and local-first apps](../../intro/active-active.md).

The Postgres data model is used as the shared schema and the source of authorisation for what data is *allowed* to sync where.

<DocCardList />
