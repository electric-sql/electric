---
title: Phoenix
description: >-
  Batteries included web framework for Elixir with Ecto migrations.
sidebar_position: 30
---

## Migrations

Use the [`Ecto.Migration.execute/1`](https://hexdocs.pm/ecto_sql/Ecto.Migration.html#execute/1) function.

First, create a migration:

```shell
mix ecto.gen.migration electrify_items
```

Then e.g.:

```elixir
defmodule MyApp.Repo.Migrations.ElectrifyItems do
  use Ecto.Migration

  def change do
    execute "ALTER TABLE items ENABLE ELECTRIC"
  end
end
```

## Event sourcing

There are quite a few options in Elixir for event sourcing. Two to flag up include:

- [cainophile/cainophile](https://github.com/cainophile/cainophile) for consuming a logical replication stream
- [https://github.com/cpursley/walex] for listening to Postgres change events and doing stuff directly in Elixir
- [Oban](https://hexdocs.pm/oban/Oban.html) for running jobs in response to database writes

You can also see the [Electric source code for consuming Postgres logical replication](https://github.com/electric-sql/electric/blob/main/components/electric/lib/electric/replication/postgres/logical_replication_producer.ex).
