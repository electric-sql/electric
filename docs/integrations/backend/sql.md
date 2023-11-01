---
title: Raw SQL
description: >-
  No framework needed. Just write or generate Postgres DDL.
sidebar_position: 60
---

## Migrations

You can execute DDLX statement using raw SQL.

Make sure you connect via the [migrations proxy](../../usage/data-modelling/migrations.md#migrations-proxy). For example using PSQL:

```console
$ psql "postgresql://postgres:$PG_PROXY_PASSWORD@localhost:$PG_PROXY_PORT/mydb"
```

Then execute the statement directly:

```sql
ALTER TABLE items
  ENABLE ELECTRIC;
```

## Event sourcing

There are many ways to consume data changes from Postgres using raw SQL. See <DocPageLink path="integrations/event-sourcing/changes" /> for more information.
