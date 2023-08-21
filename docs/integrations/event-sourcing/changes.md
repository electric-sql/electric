---
title: Change events
description: >-
  Consume data change events from Postgres.
sidebar_position: 20
---

There are many ways to consume data changes from Postgres.

## Polling

A simple way to pick up on changes for a low workload system is to poll for them. Just query on a loop and handle any new items.

## LISTEN/NOTIFY

Alternatively, for a more reactive approach, you can [LISTEN](https://www.postgresql.org/docs/current/sql-listen.html) for changes in a Postgres client.

```sql
LISTEN channel_name;
```

And then [NOTIFY](https://www.postgresql.org/docs/current/sql-notify.html):

```sql
-- Either
NOTIFY channel_name, 'something happened';

-- OR
SELECT pg_notify('channel_name', 'something happened');
```

Usually wrapped up inside a [trigger](https://www.postgresql.org/docs/current/sql-createtrigger.html) to generate the notification automatically when data changes.

## Logical replication

Postgres provides [Logical replication](https://www.postgresql.org/docs/current/logical-replication.html). This allows you to subscribe to a publication of changes. This is more reliable than LISTEN/NOTIFY because it tolerates downtime and disconnection.

There are many ways to [consume Logical replication](https://www.postgresql.org/docs/current/protocol-logical-replication.html), such as:

- Elixir: [Postgrex.ReplicationConnection](https://hexdocs.pm/postgrex/Postgrex.ReplicationConnection.html) / [cainophile/cainophile](https://github.com/cainophile/cainophile) / [supabase/realtime](https://github.com/supabase/realtime)
- Python: [psycopg2.extras.LogicalReplicationConnection](https://www.psycopg.org/docs/extras.html#psycopg2.extras.LogicalReplicationConnection)
- Typescript: [Prisma Pulse](https://www.prisma.io/data-platform/pulse)
