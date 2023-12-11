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

Sync for modern apps. From the inventors of CRDTs.

## What is ElectricSQL?

ElectricSQL is a local-first sync layer for web and mobile apps. Use it to build reactive, realtime, local-first apps directly on Postgres.

## Getting started

- [Documentation](https://electric-sql.com/docs)
- [Introduction](https://electric-sql.com/docs/intro/local-first)
- [Quickstart](https://electric-sql.com/docs/quickstart)

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
docker exec -it -e PGPASSWORD=password electric_db_a_1 psql -h localhost -U electric -d electric
```

Note that you can tear down all the containers with:

```sh
make stop_dev_env
```

### Running the release or docker container

The Electric application is configured using environment variables. Everything that doesn't have a default is required to run.

| Variable                 | Default    | Description                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`           |            | PostgreSQL connection URL for the database.                                                                                                                                                                                                                                                                                                                                                   |
| `DATABASE_REQUIRE_SSL`   | `false`    | Set to `yes` or `true` to require SSL for the connection to the database. Note that you can always configure SSL for the connection by adding `sslmode=require` to [the `DATABASE_URL` parameters](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-PARAMKEYWORDS).                                                                                                           |
| `DATABASE_USE_IPV6`      | `false`    | Set to `yes` or `true` if your database is only accessible over IPv6. This is the case with Fly Postgres, for example.                                                                                                                                                                                                                                                                        |
|                          |            |                                                                                                                                                                                                                                                                                                                                                                                               |
| `ELECTRIC_USE_IPV6`      | `true`     | Set to `false` to force Electric to only listen on IPv4 interfaces. By default, Electric will accept inbound connections over both IPv6 and IPv4 when running on Linux. On Windows and some BSD systems inbound connections over IPv4 will not be accepted unless this setting is disabled.                                                                                                   |
| `LOGICAL_PUBLISHER_HOST` |            | Host of this electric instance for the reverse connection from Postgres. It has to be accessible from the Postgres instance that is running at `DATABASE_URL`.                                                                                                                                                                                                                                |
| `LOGICAL_PUBLISHER_PORT` | `5433`     | Port number to use for reverse connections from Postgres.                                                                                                                                                                                                                                                                                                                                     |
| `HTTP_PORT`              | `5133`     | Port for HTTP connections. Includes client websocket connections on `/ws`, and other functions on `/api`.                                                                                                                                                                                                                                                                                     |
|                          |            |                                                                                                                                                                                                                                                                                                                                                                                               |
| `PG_PROXY_PORT`          | `65432`    | Port number for connections to the [Postgres migration proxy](https://electric-sql.com/docs/usage/data-modelling/migrations).                                                                                                                                                                                                                                                                 |
| `PG_PROXY_PASSWORD`      |            | Password to use when connecting to the Postgres proxy via `psql` or any other Postgres client.                                                                                                                                                                                                                                                                                                |
|                          |            |                                                                                                                                                                                                                                                                                                                                                                                               |
| `AUTH_MODE`              | `"secure"` | Authentication mode to use to authenticate Satellite clients. See below.                                                                                                                                                                                                                                                                                                                      |
| `AUTH_JWT_ALG`           |            | <p>The algorithm to use for JWT verification. Electric supports the following algorithms:</p><ul><li>`HS256`, `HS384`, `HS512`: HMAC-based cryptographic signature that relies on the SHA-2 family of hash functions.</li><li>`RS256`, `RS384`, `RS512`: RSA-based algorithms for digital signature.</li><li>`ES256`, `ES384`, `ES512`: ECC-based algorithms for digital signature.</li></ul> |
| `AUTH_JWT_KEY`           |            | The key to use for JWT verification. Must be appropriate for the chosen signature algorithm. For `RS*` and `ES*` algorithms, the key must be in PEM format.                                                                                                                                                                                                                                   |
| `AUTH_JWT_NAMESPACE`     |            | <p>This is an optional setting that specifies the location inside the token of custom claims that are specific to Electric.</p><p>Currently, only the `user_id` custom claim is required.</p                                                                                                                                                                                                  |
| `AUTH_JWT_ISS`           |            | <p>This optional setting allows you to specificy the "issuer" that will be matched against the `iss` claim extracted from auth tokens.</p><p>This can be used to ensure that only tokens created by the expected party are used to authenticate your Satellite client.</p>                                                                                                                    |
| `AUTH_JWT_AUD`           |            | <p>This optional setting allows you to specificy the "audience" that will be matched against the aud claim extracted from auth tokens.</p><p>This can be used to ensure that only tokens for a specific application are used to authenticate your Satellite client.</p>                                                                                                                       |
|                          |            |                                                                                                                                                                                                                                                                                                                                                                                               |
| `ELECTRIC_INSTANCE_ID`   | `electric` | Unique identifier of this Electric instance when running in a cluster (not yet supported). When running locally, you can use any string                                                                                                                                                                                                                                                       |

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

Migrations are semi-automatically managed by the Postgres source via a proxy implementation that intercepts your migrations and captures any relevant DDL statements.

In order to run migrations (both in production and in development) you need to configure your application to connect to the electric application on the `PG_PROXY_PORT` specified above.

The proxy will detect any modifications to electrified tables and ensure they are propagated to all satellite clients. It also allows the use of our [extended DDLX syntax](https://electric-sql.com/docs/api/ddlx).

We use various heuristics to recognise the migration framework in use in order to keep the migration version applied to the satellite clients in sync with the version applied by the framework. If your framework isn't currently supported or you would like to override the assigned version then use the `electric.migration_version` procedure:

```sql
BEGIN;
CALL electric.migration_version('20230920_114900');
CREATE TABLE public.mtable1 (id uuid PRIMARY KEY);
-- DDLX to electrify table
ALTER TABLE public.mtable1 ENABLE ELECTRIC;
COMMIT;

Note that this procedure **MUST** be called within the same transaction as the migration.

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
