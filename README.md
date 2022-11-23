![Erlang CI](https://github.com/electric-sql/electric/workflows/CI/badge.svg)
![Status - Alpha](https://img.shields.io/badge/status-alpha-red)

<a href="https://electric-sql.com">
  <picture>
    <source media="(prefers-color-scheme: dark)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-light-trans.svg"
    />
    <source media="(prefers-color-scheme: light)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
    <img alt="ElectricSQL logo"
        src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
  </picture>
</a>

# Electric

This is the replication service for [ElectricSQL](https://electric-sql.com).

It's an Elixir application that integrates with Postgres over logical replication and Satellite (ElectricSQL's client-side replication component that works with SQLite) via a web socket interface.

## Pre-reqs

Docker and [Elixir 1.14 compiled with Erlang 24](https://thinkingelixir.com/install-elixir-using-asdf/).

## Usage

See the [Makefile](./Makefile) for usage. Setup using:

```sh
make deps compile
```

Run the dependencies using:

```sh
make start_dev_env
```

Run the tests:

```sh
make tests
```

And then develop using:

```sh
make shell
```

This runs active-active replication with Postgres over logical replication and exposes a protocol buffers API over web sockets on `localhost:5133`.

For example to write some data into one of the Postgres instances:

```sh
docker exec -it -e PGPASSWORD=password electric_db_a_1 psql -h 127.0.0.1 -U electric -d electric
```

There's a second instance, `electric-db_b_1`, if you want to see data being replicated between them.

Note that you can tear down all the containers with:

```sh
make stop_dev_env
```

### Running the release or docker container

The Electric application is configured using environment variables. Everything that doesn't have a default is required to run.

| Variable | Default | Description |
| --- | --- | --- |
| `VAXINE_HOST` | | Host of Vaxine instance to connect to |
| `VAXINE_API_PORT` | `8087` | Port for the regular DB API on Vaxine instance |
| `VAXINE_REPLICATION_PORT` | `8088` | Port for the replication API on Vaxine instance |
| `VAXINE_CONNECTION_TIMEOUT` | `5000` | (ms) Timeout waiting while connecting to a Vaxine instance |
|  |
| `ELECTRIC_HOST` | | Host of this electric instance for the reverse connection from Postgres. It has to be accessible from postgres instances listed in the `CONNECTORS` |
| `CONNECTORS` | `""` | Semicolon-separated list of Postgres connection strings for PG instances that will be part of the cluster |
| |
| `POSTGRES_REPLICATION_PORT` | `5433` | Port for connections from PG instances as replication followers |
| `STATUS_PORT` | `5050` | Port to expose health and status API endpoint |
| `WEBSOCKET_PORT` | `5133` | Port to expose the `/ws` path for the replication over the websocket |
| |
| `OFFSET_STORAGE_FILE` | `./offset_storage_data.dat` | Path to the file storing the mapping between connected instances and offsets in Vaxine WAL. Should be persisted between Electric restarts. |
| `MIGRATIONS_DIR` | | Directory to read the migration SQL files from |
| `MIGRATIONS_FILE_NAME_SUFFIX` | `/postgres.sql` | Suffix that is appended to the migration name when looking for the migration file |

## Migrations

When running locally, you can apply migrations directly using `make apply_migration`. First make sure you've [built your migrations](https://electric-sql.com/docs/usage/migrations) in your application folder, then set the `MIGRATIONS_DIR` environment variable to the path to the migrations folder:

```sh
export MIGRATIONS_DIR='../path/to/migrations'
```

Now (re)run the electric service (with the env var set):

```sh
make shell
```

You can now apply named migrations using:

```sh
make apply_migration name=$MIGRATION_NAME
```

Where `MIGRATION_NAME` is the name of a migration folder created using [`electric migrations new`](https://electric-sql.com/docs/usage/migrations#2-schema-evolution), for example:

```sh
make apply_migration name=1666288253_create_items
```

## OSX

Note that if, when running on OSX, you get errors like:

```
could not connect to the publisher: connection to server at \"host.docker.internal\" (192.168.65.2), port 5433 failed
```

You may need to adjust your docker networking or run Electric within docker. To run within Docker, you can build the docker image locally:

```sh
make docker-build
```

And then run with the right env vars, e.g.:

```sh
docker run -it -p "5433:5433" -p "5133:5133" \
    -e "VAXINE_HOST=host.docker.internal"
    -e "ELECTRIC_HOST=host.docker.internal"
    -e "CONNECTORS=pg1=postgresql://electric:password@host.docker.internal:54321/electric;pg2=postgresql://electric:password@host.docker.internal:54322/electric" \
    docker.io/library/electric:local-build
```
