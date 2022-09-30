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

Docker and Elixir 1.13.

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

This runs active-active replication with Postgres over logical replication and exposes a protocol buffers API over web sockets on `localhost:30002` for the ElectricSQL client libraries.

For example to write some data into one of the Postgres instances:

```sh
docker exec -it -e PGPASSWORD=password electric_db_a_1 psql -h 127.0.0.1 -U electric -d electric
```

There's a second instance, `electric-db_b_1`, if you want to see data being replicated between them.

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
    -e "VAXINE_HOSTNAME=host.docker.internal"
    -e "ELECTRIC_HOST=host.docker.internal"
    -e "CONNECTORS=pg1=postgresql://electric:password@host.docker.internal:54321/electric;pg2=postgresql://electric:password@host.docker.internal:54322/electric" \
    docker.io/library/electric:local-build
```
