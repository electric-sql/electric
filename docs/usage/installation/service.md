---
title: Sync service
description: >-
  Run the Electric service that manages active-active replication.
sidebar_position: 40
---

The Electric sync service is an [Elixir application](https://elixir-lang.org) that manages active-active replication between your [Postgres database](./postgres.md) and your local apps.

You can run the [pre-packaged Docker images](#images) published on Docker Hub, or build and run your own Docker image, or run it directly as an Elixir service.

## Configuration

The Electric sync service is configured using environment variables. The two required variables are:

- `DATABASE_URL` in the format of a Postgres [Connection URI](https://www.postgresql.org/docs/current/libpq-connect.html#id-1.7.3.8.3.6)
- `LOGICAL_PUBLISHER_HOST` that the sync service is running on (must be accessible from the Postgres instance to establish an inbound replication subscription)

```shell
DATABASE_URL="postgresql://user:password@localhost:5432/electric"
LOGICAL_PUBLISHER_HOST="localhost"
```

See <DocPageLink path="api/service" /> for the full list of configuration options.

## Docker

### Images

Pre-packaged images are available on Docker Hub at [electricsql/electric](https://hub.docker.com/r/electricsql/electric). Run using e.g.:

```shell
docker pull electricsql/electric:latest 
docker run \
    -e "DATABASE_URL=postgresql://..." \
    -e "LOGICAL_PUBLISHER_HOST=..." \
    -e "AUTH_MODE=insecure" \
    -p 5133:5133 \
    -p 5433:5433 \
    electricsql/electric
```

### Compose

You can deploy the sync service together with [a Postgres database](./postgres.md) in a Docker Compose file. For example:

```yaml
version: '3.1'

services:
  pg:
    image: postgres
    environment:
      POSTGRES_PASSWORD: "pwd"
    ports:
      - 5432:5432
    restart: always
    volumes:
      pg_data:/var/lib/postgresql/data

  electric:
    image: electricsql/electric
    depends_on:
      - pg
    environment:
      DATABASE_URL: postgresql://postgres:pwd@pg
      LOGICAL_PUBLISHER_HOST: electric
      AUTH_MODE: insecure
    ports:
      - 5133:5133
    restart: always
    volumes:
      - electric_data:/app/data
```

### Build

See the [Makefile](https://github.com/electric-sql/electric/blob/main/components/electric/Makefile) for more details but e.g.:

```shell
docker build -t electric:local-build .
```

Then run:

```shell
docker run \
    -e "DATABASE_URL=postgresql://..." \
    -e "LOGICAL_PUBLISHER_HOST=..." \
    -e "AUTH_MODE=insecure" \
    -p 5133:5133 \
    -p 5433:5433 \
    -it electric:local-build
```

## Elixir

See the source code and usage instructions at [electric-sql/electric/components/electric](https://github.com/electric-sql/electric/tree/main/components/electric#readme).

Make sure you have [Elixir 1.15 compiled with Erlang 25](https://thinkingelixir.com/install-elixir-using-asdf/) installed.

Build:

```shell
mix deps.get
mix compile
```

Test:

```shell
mix test
```

Release:

```shell
MIX_ENV="prod" mix release
```

Run:

```shell
./_build/prod/rel/electric/bin/electric start
```
