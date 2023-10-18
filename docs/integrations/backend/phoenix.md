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

## Migrating via the Proxy

As detailed in the [migrations guide](../../usage/data-modelling/migrations.md) migrations must be applied to the Electrified database via the Electric Postgres proxy.

For a Phoenix application this means we need to slightly modify the example migration code to use a separate migrations `Repo` which is configured to connect to the proxy rather than directly to the database.

In development we need to ensure that migrations are always applied via the proxy, and not directly on the database.

The simplest solution is to create a new Ecto repo module that encapsulates the proxy connection and then
use it when running the migrations:

```elixir
# lib/my_app/proxy_repo.ex
defmodule MyApp.ProxyRepo do
  use Ecto.Repo,
    otp_app: :my_app,
    adapter: Ecto.Adapters.Postgres
end
```

```elixir
# config/config.exs

# override Ecto's list of repos that it applies migrations to by default
config :my_app,
  ecto_repos: [MyApp.ProxyRepo]
```

```elixir
# config/dev.exs
config :my_app, MyApp.ProxyRepo,
  ssl: false,
  url: "postgres://electric:proxy-password@localhost:65432/myapp",
  # we only use this repo for migrations
  pool_size: 2,
  # when we run `mix ecto.gen.migration ...` we want the generated migration file
  # to belong to the "real" `MyApp.Repo` this will also mean that any existing
  # migrations will be recognized automatically.
  priv: "priv/repo"
```

```elixir
# config/runtime.exs
# because we need to apply migrations in production, ensure that
# the ProxyRepo is included in the runtime.exs configuration.
config :my_app, MyApp.ProxyRepo,
  ssl: false,
  url: System.get_env("PROXY_URL"),
  pool_size: 2,
  priv: "priv/repo"
```

With this infrastructure in place, running `mix ecto.migrate` will correctly apply the migrations through the proxy.

### Migrating in production via the Proxy

With the above configuration in place, the [example code from the Phoenix](https://hexdocs.pm/phoenix/releases.html#ecto-migrations-and-custom-commands) and [the EctoSQL docs](https://hexdocs.pm/ecto_sql/Ecto.Migrator.html#module-example-running-migrations-in-a-release) will just work and apply migrations through the proxy in development and production.

## Event sourcing

There are quite a few options in Elixir for event sourcing. Two to flag up include:

- [cainophile/cainophile](https://github.com/cainophile/cainophile) for consuming a logical replication stream
- [cpursley/walex](https://github.com/cpursley/walex) for listening to Postgres change events and doing stuff directly in Elixir
- [Oban](https://hexdocs.pm/oban/Oban.html) for running jobs in response to database writes

You can also see the [Electric source code for consuming Postgres logical replication](https://github.com/electric-sql/electric/blob/main/components/electric/lib/electric/replication/postgres/logical_replication_producer.ex).
