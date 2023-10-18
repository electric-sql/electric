---
title: Phoenix
description: >-
  Batteries included web framework for Elixir with Ecto migrations.
sidebar_position: 30
---

## Migrating via the Proxy

As detailed in the [migrations guide](../../usage/data-modelling/migrations.md) migrations must be applied to the Electrified database via the Electric Postgres proxy.

For a Phoenix application this means we need to slightly modify the example migration code to use a separate migrations `Repo` which is configured to connect to the proxy rather than directly to the database.

In development we need to ensure that migrations are always applied via the proxy, and not directly on the database.

The simplest solution is to create a new Ecto repo module that encapsulates the proxy connection and then configure Ecto to use it when running the migrations:

First we add a new repo instance. Note that, unlike the main `Repo` module, we don't start this with the rest of our application.

```elixir
# lib/my_app/proxy_repo.ex
defmodule MyApp.ProxyRepo do
  use Ecto.Repo,
    otp_app: :my_app,
    adapter: Ecto.Adapters.Postgres
end
```

Configure Ecto to use the `ProxyRepo` for generating and running migrations. Because in most cases queries through the proxy will just pass unmodified to the backing Postgresql server, it's ok that the proxy repo will be used for other Ecto mix tasks apart from applying migrations.

```elixir
# config/config.exs

# override Ecto's list of repos that it applies migrations to by default
config :my_app,
  ecto_repos: [MyApp.ProxyRepo]
```

Now we need to include configuration for the ProxyRepo in both development and production mode:

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

With this infrastructure in place, running `mix ecto.migrate` will correctly apply the migrations through the proxy by default.

Optionally you can tweak the way that migrations are generated and ensure that they are correctly named for the base repo rather than the proxy repo by adding an alias to your application's `mix.exs`:

```elixir

  defp aliases do
    [
      # ...
      "ecto.gen.migration": ["ecto.gen.migration -r MyApp.Repo"]
    ]
  end
```

If you don't add this alias then your migrations will be named e.g. `MyApp.ProxyRepo.Migrations.MigrationName` not `MyApp.Repo.Migrations.MigrationName`.

### Migrating in production via the Proxy

Because we've configured Ecto to go via the proxy repo by default, the [example code from the Phoenix](https://hexdocs.pm/phoenix/releases.html#ecto-migrations-and-custom-commands) and [the EctoSQL docs](https://hexdocs.pm/ecto_sql/Ecto.Migrator.html#module-example-running-migrations-in-a-release) will just work and apply migrations through the proxy in development and production.

## Creating and Applying Migrations

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

As above, the Ecto configuration means that these actions are applied via the Electric migration proxy automatically.

## Event sourcing

There are quite a few options in Elixir for event sourcing. Two to flag up include:

- [cainophile/cainophile](https://github.com/cainophile/cainophile) for consuming a logical replication stream
- [cpursley/walex](https://github.com/cpursley/walex) for listening to Postgres change events and doing stuff directly in Elixir
- [Oban](https://hexdocs.pm/oban/Oban.html) for running jobs in response to database writes

You can also see the [Electric source code for consuming Postgres logical replication](https://github.com/electric-sql/electric/blob/main/components/electric/lib/electric/replication/postgres/logical_replication_producer.ex).
