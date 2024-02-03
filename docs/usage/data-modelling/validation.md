---
title: Validation
description: >-
  How to validate user input.
sidebar_position: 60
---

:::caution Work in progress
User input validation is under active development. As we progress we will update this documentation.
:::

## Immutable Primary Keys

Electric rejects updates to a table's primary keys.

In order to maintain referential integrity and track changes from connected clients, Electric requires all primary keys to be treated as immutable. An attempt to synchronise a client where a primary key has been changed will be rejected by the server and the offending client will be forcibly disconnected.

```sql
CREATE TABLE items (
  id uuid PRIMARY KEY,
  value text
);

INSERT INTO
  items (id, value)
VALUES
  ('f2ece325-219f-40e2-b5b1-fdb32e32f0ed', 'my first value');

-- don't do this!
UPDATE
  items
SET
  id = 'cfe89786-8170-4438-b667-b7874eb5c54c'
WHERE
  id = 'f2ece325-219f-40e2-b5b1-fdb32e32f0ed';
```

This will leave the client in an inconsistent state and unable to sync until the local database has been reset.

Currently this validation is only applied by the sync service, but in future there will also be client-side validation.

## Roadmap

Validation will be defined using [check constraints](./constraints.md#check-constraints) and [DDLX rules](../../api/ddlx.md). Validation logic will then be compiled to run both in the [Client](../data-access/client.md) and on the server.

See <DocPageLink path="reference/architecture" /> and <DocPageLink path="reference/roadmap" /> for more information
