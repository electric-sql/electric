---
title: Installation - Guide
description: >-
  How to install and run Electric.
outline: [2, 3]
---

# Installation

You need to have a [Postgres](https://www.postgresql.org) database and to run the [Electric sync service](/product/sync) in front of it.

## How to run Electric

Electric is a web application published as a Docker image at [electricsql/electric](https://hub.docker.com/r/electricsql/electric). It connects to Postgres via a `DATABASE_URL`.

## Recommended

The simplest way to run Electric is using Docker.

### Using Docker

You can run a fresh Postgres and Electric connected together using [Docker Compose](https://docs.docker.com/compose) with this [`docker-compose.yaml`](https://github.com/electric-sql/electric/blob/main/website/public/docker-compose.yaml):

<<< @/public/docker-compose.yaml

For example you can run this using:

```sh
curl -O https://electric-sql.com/docker-compose.yaml
docker compose up
```

Alternatively, you can run the Electric sync service on its own and connect it to an existing Postgres database, e.g.:

```sh
docker run \
    -e "DATABASE_URL=postgresql://..." \
    -p 3000:3000 \
    -t \
    electricsql/electric:latest
```

### Postgres requirements

You can use any Postgres (new or existing) that has [logical replication](https://www.postgresql.org/docs/current/logical-replication-config.html) enabled. You also need to connect as a database user that has the [`REPLICATION`](https://www.postgresql.org/docs/current/logical-replication-security.html) privilege.


## Advanced

You can also choose to build and run Electric [from source](https://github.com/electric-sql/electric) as an [Elixir](https://elixir-lang.org) application.

### Build from source

Clone the Electric repo:

```sh
git clone https://github.com/electric-sql/electric.git
cd electric
```

Install the system dependencies with [asdf](https://asdf-vm.com). Versions are defined in [.tool-versions](https://github.com/electric-sql/electric/blob/main/.tool-versions):

```sh
asdf plugin-add elixir
asdf plugin-add erlang
asdf plugin-add nodejs
asdf plugin-add pnpm
asdf install
```

Install the [packages/sync-service](https://github.com/electric-sql/electric/tree/main/packages/sync-service) dependencies using [Mix](https://hexdocs.pm/mix/1.12/Mix.html).:

```sh
cd packages/sync-service
mix deps.get
```

Run the development server:

```sh
mix run --no-halt
```

This will try to connect to Postgres using the `DATABASE_URL` configured in [packages/sync-service/.env.dev](https://github.com/electric-sql/electric/blob/main/packages/sync-service/.env.dev), which defaults to:

<<< @/../packages/sync-service/.env.dev

You can edit this file to change the configuration. To run the tests, you'll need a Postgres running that matches the `:test` env config in [config/runtime.exs](https://github.com/electric-sql/electric/blob/main/packages/sync-service/config/runtime.exs) and then:

```sh
mix test
```

If you need any help, [ask on Discord](https://discord.electric-sql.com).
