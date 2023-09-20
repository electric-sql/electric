---
title: Sync service
description: >-
  Runtime configuration options for the Electric sync service.
sidebar_position: 20
---

The Electric sync service is an Elixir application that manages [active-active replication](/docs/intro/active-active) between your Postgres database and your [local apps](/docs/intro/local-first). This page documents all of the configuration options supported by the service.

The standard way to start Electric sync service is using the official Docker image which can be run either from the command line or via Docker Compose. In both cases, the configuration options are passed to the service as environment variables as in the following example:

```shell
docker run \
    -e "DATABASE_URL=postgresql://..." \
    -e "LOGICAL_PUBLISHER_HOST=..." \
    -e "AUTH_JWT_ALG=HS512" \
    -e "AUTH_JWT_KEY=..." \
    -p 5133:5133 \
    -p 5433:5433 \
    electricsql/electric
```

For detailed installation and running instructions see <DocPageLink path="usage/installation/service" />.

## Configuration options

The Electric application is configured using environment variables.

### Core config

Everything in the table below that doesn't have a default value is required to run the sync service.

| Variable                                            | Description                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                      | PostgreSQL connection URL for the database.                                                                                                                                                                                                                                                                                     |
| `DATABASE_REQUIRE_SSL`<p>&nbsp;&nbsp;(`false`)</p>  | Set to `yes` or `true` to require SSL for the connection to the database. Alternatively configure SSL for the connection by adding `sslmode=require` to [the `DATABASE_URL` parameters](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-PARAMKEYWORDS). Values set in the `DATABASE_URL` will have precedence. |
| `LOGICAL_PUBLISHER_HOST`                            | Host of this electric instance for the reverse connection from Postgres. It has to be accessible from the Postgres instance that is running at `DATABASE_URL`.                                                                                                                                                                  |
| `LOGICAL_PUBLISHER_PORT`<p>&nbsp;&nbsp;(`5433`)</p> | Port number to use for reverse connections from Postgres.                                                                                                                                                                                                                                                                       |
| `HTTP_PORT`<p>&nbsp;&nbsp;(`5133`)</p>              | Port for HTTP connections. Includes client websocket connections on `/ws`, and other functions on `/api`                                                                                                                                                                                                                        |

### Authentication

When `AUTH_MODE=secure` (the default), the `AUTH_JWT_ALG` and `AUTH_JWT_KEY` options are also required.

When `AUTH_MODE=insecure`, all other authentication options can be omitted.

| Variable                                 | Description                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AUTH_MODE`<p>&nbsp;&nbsp;(`secure`)</p> | <p>Authentication mode to use to authenticate clients.</p><p>[Secure authentication](/docs/usage/auth/secure) is assumed by default and is <strong>strongly recommended</strong> for production use.</p><p>The other option is [Insecure authentication](/docs/usage/auth/insecure) which should only be used in development.</p>                                                 |
| `AUTH_JWT_ALG`                           | <p>The algorithm to use for JWT verification. Electric supports the following algorithms:</p><ul><li>`HS256, HS384, HS512:` HMAC-based cryptographic signature that relies on the SHA-2 family of hash functions.</li><li>`RS256, RS384, RS512:` RSA-based algorithms for digital signature.</li><li>`ES256, ES384, ES512:` ECC-based algorithms for digital signature.</li></ul> |
| `AUTH_JWT_KEY`                           | The key to use for JWT verification. Must be appropriate for the chosen signature algorithm. For `RS*` and `ES*` algorithms, the key must be in PEM format.                                                                                                                                                                                                                       |
| `AUTH_JWT_NAMESPACE`                     | <p>This is an optional setting that specifies the location inside the token of custom claims that are specific to Electric.</p><p>Currently, only the `user_id` custom claim is required.</p>                                                                                                                                                                                     |
| `AUTH_JWT_ISS`                           | <p>This optional setting allows you to specificy the "issuer" that will be matched against the `iss` claim extracted from auth tokens.</p><p>This can be used to ensure that only tokens created by the expected party are used to authenticate your client.</p>                                                                                                                  |
| `AUTH_JWT_AUD`                           | <p>This optional setting allows you to specificy the "audience" that will be matched against the aud claim extracted from auth tokens.</p><p>This can be used to ensure that only tokens for a specific application are used to authenticate your client.</p>                                                                                                                     |

### Telemetry

By default, ElectricSQL collects aggregated, anonymous usage data and sends them to our telemetry service. See <DocPageLink path="reference/telemetry" /> for more information.

It's extremely helpful to leave telemetry enabled if you can.

| Variable                                 | Description                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `ELECTRIC_TELEMETRY`<p>&nbsp;&nbsp;(`enabled`)</p> | <p>Telemetry mode. Telemetry is enabled by default. Set to `disabled` to disable collection.</p> |


## Networking requirements

It's important to note that Postgres and Electric must be able to connect to each other. Specifically:

1. the Electric sync service connects to Postgres using the `DATABASE_URL` environment variable
2. Postgres connects to Electric to consume a logical replication publication using the `LOGICAL_PUBLISHER_HOST` (and `LOGICAL_PUBLISHER_PORT`) environment variables

```
         |<--------DATABASE_URL----------|
Postgres |                               | Electric
         |-----LOGICAL_PUBLISHER_HOST--->|
```

As a result, you must make sure (in terms of networking / firewalls) not only that Postgres is reachable from Electric but also that Electric is reachable from Postgres. And Electric must know its own address, in order to provide it to Postgres when setting up the logical replication publication that allows writes to be replicated into Postgres.
