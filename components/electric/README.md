[![CI](https://github.com/electric-sql/electric/workflows/CI/badge.svg)](https://github.com/electric-sql/electric/actions/workflows/ci.yml)
[![License - Apache 2.0](https://img.shields.io/badge/license-Apache_2.0-blue)](main/LICENSE)
![Status - Alpha](https://img.shields.io/badge/status-alpha-red)
[![Chat - Discord](https://img.shields.io/discord/933657521581858818?color=5969EA&label=discord)](https://discord.electric-sql.com)

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

# ElectricSQL

Local-first. Electrified.

You develop local-first apps. We provide the cloud sync. Without changing your database or your code.

## What is ElectricSQL?

ElectricSQL is a local-first SQL system that adds active-active replication and reactive queries to SQLite and Postgres. Use it to make local-first apps that feel instant, work offline and sync via the cloud.

## Getting started

- [Quickstart](https://electric-sql.com/docs/usage/quickstart)
- [Examples](https://github.com/electric-sql/examples)
- [Documentation](https://electric-sql.com/docs)

## Repo structure

This repo contains the core backend services that proovide ElectricSQL's cloud sync. It's an Elixir application that integrates with Postgres over logical replication and SQLite via a Protobuf web socket protocol.

See also:

- [electric-sql/typescript-client](https://github.com/electric-sql/typescript-client) Typescript client library for local-first application development
- [electric-sql/cli](https://github.com/electric-sql/cli) command line interface (CLI) tool to manage config and migrations

## Pre-reqs

Docker and [Elixir 1.15 compiled with Erlang 25](https://thinkingelixir.com/install-elixir-using-asdf/).

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

| Variable                 | Default                     | Description                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           |                             | PostgreSQL connection URL for the database.                                                                                                                                                                                                                                                                                                                                                   |
|                          |                             |                                                                                                                                                                                                                                                                                                                                                                                               |
| `LOGICAL_PUBLISHER_HOST` |                             | Host of this electric instance for the reverse connection from Postgres. It has to be accessible from the Postgres instance that is running at `DATABASE_URL`.                                                                                                                                                                                                                                |
| `LOGICAL_PUBLISHER_PORT` | `5433`                      | Port number to use for reverse connections from Postgres.                                                                                                                                                                                                                                                                                                                                     |
| `HTTP_API_PORT`          | `5050`                      | Port to expose the HTTP API endpoint on.                                                                                                                                                                                                                                                                                                                                                      |
| `WEBSOCKET_PORT`         | `5133`                      | Port to expose the `/ws` path for the replication over the websocket.                                                                                                                                                                                                                                                                                                                         |
|                          |                             |                                                                                                                                                                                                                                                                                                                                                                                               |
| `OFFSET_STORAGE_FILE`    | `./offset_storage_data.dat` | Path to the file storing the mapping between connected Postgres, Satellite instances, and an internal event log. Should be persisted between Electric restarts.                                                                                                                                                                                                                               |
|                          |                             |                                                                                                                                                                                                                                                                                                                                                                                               |
| `AUTH_MODE`              | `"secure"`                  | Authentication mode to use to authenticate Satellite clients. See below.                                                                                                                                                                                                                                                                                                                      |
| `AUTH_JWT_ALG`           |                             | <p>The algorithm to use for JWT verification. Electric supports the following algorithms:</p><ul><li>`HS256`, `HS384`, `HS512`: HMAC-based cryptographic signature that relies on the SHA-2 family of hash functions.</li><li>`RS256`, `RS384`, `RS512`: RSA-based algorithms for digital signature.</li><li>`ES256`, `ES384`, `ES512`: ECC-based algorithms for digital signature.</li></ul> |
| `AUTH_JWT_KEY`           |                             | The key to use for JWT verification. Must be appropriate for the chosen signature algorithm. For `RS*` and `ES*` algorithms, the key must be in PEM format.                                                                                                                                                                                                                                   |
| `AUTH_JWT_NAMESPACE`     |                             | <p>This is an optional setting that specifies the location inside the token of custom claims that are specific to Electric.</p><p>Currently, only the `user_id` custom claim is required.</p                                                                                                                                                                                                  |
| `AUTH_JWT_ISS`           |                             | <p>This optional setting allows you to specificy the "issuer" that will be matched against the `iss` claim extracted from auth tokens.</p><p>This can be used to ensure that only tokens created by the expected party are used to authenticate your Satellite client.</p>                                                                                                                    |
| `AUTH_JWT_AUD`           |                             | <p>This optional setting allows you to specificy the "audience" that will be matched against the aud claim extracted from auth tokens.</p><p>This can be used to ensure that only tokens for a specific application are used to authenticate your Satellite client.</p>                                                                                                                       |
|                          |                             |                                                                                                                                                                                                                                                                                                                                                                                               |
| `ELECTRIC_INSTANCE_ID`   | `electric`                  | Unique identifier of this Electric instance when running in a cluster (not yet supported). When running locally, you can use any string                                                                                                                                                                                                                                                       |

**Authentication**

By default, Electric uses JWT-based authentication. At a minimum, the signature algorithm and an appropriate key must be
configured via the environment variables `AUTH_JWT_ALG` and `AUTH_JWT_KEY`.

You also have the option of using the `"insecure"` authentication mode in development and for testing. In this mode,
the algorithm and key configuration options are ignored. Both unsigned and signed JWTs are accepted, no signature
verification is performed in the latter case.

The auth token must have a `"user_id"` claim at the top level or under a namespace key if it is configured via
`AUTH_JWT_NAMESPACE`.

For development and testing purposes, you can generate a valid token using these configuration values by running `mix
electric.gen.token`, e.g:

```shell
$ export AUTH_JWT_ALG=HS256
$ export AUTH_JWT_KEY=00000000000000000000000000000000
$ mix electric.gen.token my_user_id
```

This token can be used with the Electric server running in either `secure` or `insecure` mode. In the latter case, the
Electric server must be configured with the same algorithm and key for the token to pass verification.

See [our official docs](https://electric-sql.com/docs/usage/auth) to learn about authentication in detail.

## Migrations

Migrations are semi-automatically managed by the Postgres source. Once Postgres has been initialized by Electric (i.e. Electric had connected to it at least once), you will have two functions available in your SQL:

1. `SELECT electric.migration_version(migration_version);`, where `migration_version` should be a monotonically growing value of your choice
2. `CALL electric.electrify(table_name);`, where `table_name` is a string containing a schema-qualified name of the table you want electrified.

When you want to do a migration (i.e. create a table), you need to run the `electric.migration_version` at the beginning of the transaction, and `electric.electrify` for every new table. Electrified tables and changes to them
will reach the clients and be created there as well. For example:

```sql
BEGIN;
SELECT electric.migration_version('1_version');
CREATE TABLE public.mtable1 (id uuid PRIMARY KEY);
CALL electric.electrify('public.mtable1');
COMMIT;
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
    -e "DATABASE_URL=postgresql://electric:password@host.docker.internal:54321/electric" \
    -e "LOGICAL_PUBLISHER_HOST=host.docker.internal" \
    electric:local-build
```

## Contributing

See the [Community Guidelines](https://github.com/electric-sql/meta) including the [Guide to Contributing](https://github.com/electric-sql/meta/blob/main/CONTRIBUTING.md) and [Contributor License Agreement](https://github.com/electric-sql/meta/blob/main/CLA.md).

## Support

We have an [open community Discord](https://discord.electric-sql.com). If you’re interested in the project, please come and say hello and let us know if you have any questions or need any help or support getting things running.
