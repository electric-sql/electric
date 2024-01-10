---
title: CLI & Generator
description: >-
  Command-line interface for the `npx electric-sql generate` script and other commands.
sidebar_position: 30
---

# CLI Commands

The Electric client library comes with a CLI providing a number of helpful commands for building Electric apps:

- [`generate`](#generate) - The type-safe client generator; this command builds the client library for your applications to use.
- [`proxy-tunnel`](#proxy-tunnel) - A tool to enable you to connect to the Electric migrations proxy when it's deployed behind an restrictive firewall, or with a hosting provider, that only allows incoming HTTP connections.
- [`start`](#start) - Start an Electric sync service for development, along with an optional PostgreSQL
- [`stop`](#stop) - Stop the development Electric sync service, and any optional PostgreSQL
- [`status`](#status) - Show status of the development Electric sync service docker containers
- [`psql`](#psql) - Connect with psql to the Migration proxy
- [`configure-ports`](#configure-ports) - Configure the ports used by the Electric sync service
- [`show-config`](#show-config) - Show the current configuration
- [`with-config`](#with-config) - Run a sub command with config arguments substituted
- [`help`](#help) - Display help for a command

These commands are all executed in the form `npx electric-sql [command-name]` from within a project where you have installed the [client library](../usage/installation/client).

All commands accept both arguments or environment variables for configuration, and the CLI uses [dotenv-flow](https://www.npmjs.com/package/dotenv-flow) to load environment variables from `.env` files. When a command line argument is provided it takes precedence over the environment variable. See a [full list of environment variables](#environment-variables).

## Commands

### `generate`

To interface with your database from within a JavaScript or TypeScript application you need an Electric client (see <DocPageLink path="usage/data-access/client" /> for context). To generate an Electric client, make sure that your database and the Electric sync service are up and running.
Then, from within the root folder of your application run:

```shell
npx electric-sql generate
```

This will download all migrations from the database, bundle them with your application, and generate the Electric client.
Note that you can use an optional `--watch` flag to automatically re-generate the client on every database migration.

#### Options

The `generate` command accepts a number of arguments:

```shell
npx electric-sql generate [--service <url>] [--proxy <url>] [--out <path>] [--watch [<pollingInterval>]]
```

All arguments are optional. The principal ones are described below:

| Argument or Env var  | Value        | Description                              |
|----------------------|--------------|------------------------------------------|
| <span className="no-wrap">`--service`</span><br/><span className="no-wrap">`-s`</span><br/>`ELECTRIC_SERVICE` |`<url>` | Provides the url to connect to the [Electric sync service](./service.md).<br /> Defaults to `http://localhost:5133`. |
| <span className="no-wrap">`--proxy`</span><br/><span className="no-wrap">`-p`</span><br/>`ELECTRIC_PROXY` | `<url>` | Provides the url to connect to Electric's database proxy.<br /> Defaults to <span class="break-all">`postgresql://prisma:proxy_password@localhost:65432/electric`</span>. |
| <span className="no-wrap">`--client-path`</span><br /><span className="no-wrap">`-o`</span><br />`ELECTRIC_CLIENT_PATH` | `<path>` | Specifies the output location for the generated client.<br /> Defaults to `./src/generated/client` |
| <span className="no-wrap">`--watch`</span><br /><span className="no-wrap">`-w`</span> | `<pollingInterval>` | Run the generator in watch mode. Accepts an optional polling interval (in milliseconds) which defines how often to poll Electric for database migrations.<br /> The default polling interval is 1000ms. |
| <span className="no-wrap">`--with-migrations`</span> | `<command>` | Specify a command to run migrations against a blank postgres in order to create a client. [See details below](#generate---with-migrations) |
| <span className="no-wrap">`--module-resolution`</span> | `<command>` | The module resolution used for the project. The generated client will be compatible with this resolution scheme. |

:::caution
Note that the username in the `--proxy` URL **must** be `prisma`.

This is to activate the proxy mode that uses Prisma tooling for schema introspection. It does not mean that your Postgres database actually needs a `prisma` user.
:::

For a full list of arguments run `npx electric-sql help generate` or see the [environment variables](#environment-variables) below.

#### Local-only-first mode  

Normally, when you develop or deploy apps with Electric, you want to run the backend services (Postgres and Electric) in order to sync data. As a result, it's natural that the `generate` command expects you to be running the backend services during your build step.  

However, it's also quite common in development or with an early version of an app, not to need data sync enabled yet. Either because you're just working on the interface or because your app starts off local-only and you plan to enable sync later. This makes the overhead of running (and potentially deploying) the backend services quite high, given that you're running them just to support the generate command in your build step.  

As a result, we provide a special `--with-migrations` mode for the generate command that allows you to generate the type safe client just from your migrations, without having to run the backend services yourself. Specifically what the `--with-migrations` option does is it tells the generate command to spin up a temporary Postgres and Electric itself, apply your migrations from scratch, generate the type safe client and then tear Electric and Postgres down. All of which happens automatically in the background for you.  

We call this approach "local-only-first", in the sense that it allows you to develop local-only and then progressively enable sync later on, as and when you want to.  

The `--with-migrations` command that takes the same argument form as the [`with-config`](#with-config) command. With this you can run:

```shell
npx electric-sql generate --with-migrations "npx pg-migrations apply --database {{ELECTRIC_PROXY}} --directory ./db/migrations"
```

In essence this is the equivalent of:

```shell
npx electric-sql start
npx electric-sql with-config "npx pg-migrations apply --database {{ELECTRIC_PROXY}} --directory ./db/migrations"
npx electric-sql generate
npx electric-sql stop --remove
```

As you can see from the steps above, the backend is started, your migrations are applied, the type-safe client is generated and then everything is torn down and cleaned up for you. Allowing you to develop local-only-first and then run the backend services only when you actually want to enable sync.  


#### `generate --with-migrations`

Normally the `generate` command expects to be run against an Electric and Postgres where you already have a full schema installed. However you may want to work in a *"local only first"* way, generating a client directly from either SQL migrations or using a migration tool such as Prisma, without having to continually run a Postgres server and Electric sync service.

The [`generate`](#generate) command takes an optional `--with-migrations` command that takes the same argument form as the [`with-config`](#with-config) command. With this you can run:

```shell
npx electric-sql generate --with-migrations "npx pg-migrations apply --database {{ELECTRIC_PROXY}} --directory ./db/migrations"
```

This will perform these tasks, allowing you to generate a client directly from a set of migrations:

1. Start new Electric and PostgreSQL containers
2. Run the provided migrations command
3. Generate the client
4. Stop and remove the containers

In essence this is the equivalent of:

```shell
npx electric-sql start
npx electric-sql with-config "npx pg-migrations apply --database {{ELECTRIC_PROXY}} --directory ./db/migrations"
npx electric-sql generate
npx electric-sql stop --remove
```

### `proxy-tunnel`

Some hosting providers only allow HTTP connections, which poses a challenge for deploying Electric to their platforms since it uses a separate port for connections to the [migrations proxy](../usage/data-modelling/migrations#migrations-proxy). In order to enable connecting to run migrations and use the generate command in these setups, you can enable a special "Proxy Tunnel" that tunnels the Postgres Proxy TCP connection over a Websocket to the Electric sync service. This is enabled on the sync service by setting the environment variable `PG_PROXY_PORT=http`.

The `npx electric-sql proxy-tunnel` command is provided to forward TCP traffic from your local machine to the Electric Postgres Proxy when it has tunneling enabled. It binds to a local port, allowing you to use the generator command, perform migrations, and connect with psql.

To connect to the service, and create a local proxy tunnel:

```shell
npx electric-sql proxy-tunnel --service http://my.electric.host:5133 --local-port 65431
```

Then to run migrations, if you are using [@databases/pg-migrations](https://www.atdatabases.org/docs/pg-migrations) as we do in our [starter template](../quickstart/?setup=generator#setup), you can run this in another shell:

```shell
npx pg-migrations apply --database postgres://postgres:proxy_password@localhost:65431 --directory ./db/migrations
```

To then use the `generate` command to create your client:

```shell
npx electric-sql generate --service http://my.electric.host:5133 --proxy postgresql://prisma:proxy_password@localhost:65431/electric
```

#### Options

The `proxy-tunnel` command accepts a number of arguments:

```shell
npx electric-sql proxy-tunnel [--service <url>] [--local-port <port>]
```

All arguments are optional and are described below:

| Argument or Env var  | Value        | Description                              |
|----------------------|--------------|------------------------------------------|
| <span className="no-wrap">`--service`</span><br/>`ELECTRIC_SERVICE` | `<url>` | Provides the url to connect to the Electric sync service. If not provided it uses the url set in the `ELECTRIC_URL` environment variable. If that variable is not set, it resorts to the default url which is `http://localhost:5133`. |
| <span className="no-wrap">`--local-port`</span> | `<port>` | The local port to bind to; this will be forwarded to the Electric sync service, and defaults to `65432`. |

### `start`

Starts an Electric sync service (using Docker) for development, along with an optional Postgres database.

By default it will launch a sync service that is compatible with the client version you have installed.

All [environment variables for configuring the Electric sync service](./service.md#configuration-options)  are passed through to the service if they are found prefixed with `ELECTRIC_`.

To start an Electric sync service, along with Postgres, fully configured for development run:

```shell
npx electric-sql start --with-postgres
```

#### Options

The `start` command accepts a number of arguments:

```shell
npx electric-sql start [options]
```

All arguments are optional. The principal ones are described below:

| Argument or Env var  | Value        | Description                              |
|----------------------|--------------|------------------------------------------|
| <span className="no-wrap">`--with-postgres`</span> |  | Start a Postgres database along with Electric.
| <span className="no-wrap">`--detach`</span> |  | Run in the background instead of printing logs to the console.
| <span className="no-wrap">`--database-url`</span><br/><span className="no-wrap">`-db`</span><br/>`ELECTRIC_DATABASE_URL` | `<url>` | PostgreSQL connection URL for the database. |
| <span className="no-wrap">`--http-port`</span><br />`ELECTRIC_HTTP_PORT` | `<port>` | The local port to run the sync service on. Defaults to 5133 |
| <span className="no-wrap">`--pg-proxy-port`</span><br />`ELECTRIC_PG_PROXY_PORT` | `<port>` | The local port to bind the Postgres Proxy port to. Defaults to 65432 |
| <span className="no-wrap">`--image`</span><br />`ELECTRIC_IMAGE` | `<image>` | The Docker image to use for Electric. |
| <span className="no-wrap">`--postgresql-image`</span><br />`ELECTRIC_POSTGRESQL_IMAGE` | `<image>` | The Docker image to use for the PostgreSQL database. |

For a full list of arguments run `npx electric-sql help start` or see the [environment variables](#environment-variables) below.

### `stop`

Stop the development Electric sync service that was started with the [`start`](#start) command, and any optional PostgreSQL.

```shell
npx electric-sql stop [--remove]
```

#### Options

The `start` command accepts a single argument:

| Argument             | Description                              |
|----------------------|------------------------------------------|
| <span className="no-wrap">`--remove`</span> | Remove the containers and volumes from Docker.

### `status`

Show status of the Electric sync service docker containers that were started with the [`start`](#start) command.

```shell
npx electric-sql status
```

### `psql`

Start an interactive PSQL session with Postgres, connecting via the Electric [Migrations proxy](../usage/data-modelling/migrations.md#migrations-proxy).

```shell
npx electric-sql psql [--proxy <url>]
```

#### Options

The `psql` command accepts a number of arguments for specifying the Migrations proxy to connect to, the main one being:

| Argument or Env var  | Value        | Description                              |
|----------------------|--------------|------------------------------------------|
| <span className="no-wrap">`--proxy`</span><br /><span className="no-wrap">`-p`</span><br />`ELECTRIC_PROXY` | `<url>` | URL of the Electric service's PostgreSQL proxy.

For a full list of arguments run `npx electric-sql help psql` or see the [environment variables](#environment-variables) below.

### `configure-ports`

Configure the ports used by the Electric sync service.

This starts an interactive session where you are asked to specify the ports you would like to use. These are then written to your `.env.local` file, and used for the other commands.

```shell
npx electric-sql configure-ports
```

### `show-config`

Print out the full configuration that the CLI is using based on any env variable, or `.env` files.

```shell
npx electric-sql show-config
```

### `with-config`

This command allows you to run a subcommand substituting arguments configured with Electric environment variables. It also makes all Electric configuration environment variables available to the subcommand.

One of the main use cases for this command is running migrations against your Electric Postgres Proxy using the configuration specified locally. 

It takes a single string argument, which is the command to run in string form, and substitutes configuration values inside double braces:

```shell
npx electric-sql with-config "run-migration --db {{ELECTRIC_PROXY}}"
```

Many of our examples use the [@databases/pg-migrations](https://www.atdatabases.org/docs/pg-migrations) tool for migrations, and we run the migrations with:

```shell
npx electric-sql with-config "npx pg-migrations apply --database {{ELECTRIC_PROXY}} --directory ./db/migrations"
```

We have this configured as a "script" in our `package.json` for each example:

```js
// package.json
{
  //...
  "scripts": {
    "db:migrate": "npx electric-sql with-config \"npx pg-migrations apply --database {{ELECTRIC_PROXY}} --directory ./db/migrations\"",
    // ...
  }
}
```

### `help`

Display the help for a command.

```shell
npx electric-sql help <command>
```

## Environment Variables

In addition to those specified below, all standard Electric sync service environment variables are available for setting prefixed with `ELECTRIC_`. These are then passed though to the sync service started with the [`start`](#start) command. See a [full list of environment variables here](./service.md#configuration-options).

import EnvVarConfig from '@site/src/components/EnvVarConfig'

#### `ELECTRIC_SERVICE`

<EnvVarConfig
    name="ELECTRIC_SERVICE"
    defaultValue="http://{ELECTRIC_SERVICE_HOST}:{ELECTRIC_HTTP_PORT}"
    example="http://electric.mydomain.com"
>
  URL of the Electric service.

  Used by the [`generate`](#generate) command.

  With all defaults, it evaluates to `http://localhost:5133`
</EnvVarConfig>

This `ELECTRIC_SERVICE` variable is perfect for configuring the Electric client in your project. 

```typescript
import { schema } from './generated/client'

const conn = await ElectricDatabase.init(scopedDbName)
const electric = await electrify(conn, schema, {
  url: import.meta.env.ELECTRIC_SERVICE
  // ...
})
```

#### `ELECTRIC_PROXY`

<EnvVarConfig
    name="ELECTRIC_PROXY"
    defaultValue="postgresql://postgres:{ELECTRIC_PG_PROXY_PASSWORD}@{ELECTRIC_SERVICE_HOST}:{ELECTRIC_PG_PROXY_PORT}/{ELECTRIC_DATABASE_NAME}"
    example="postgresql://postgres:proxy_password@electric.mydomain.com:65432/electric"
>
  URL of the Electric service's PostgreSQL proxy.

  Used by the [`generate`](#generate) and [`psql`](#psql) commands.

  With all defaults, it evaluates to:
  `postgresql://postgres:proxy_password@localhost:65432/electric`
</EnvVarConfig>

#### `ELECTRIC_CLIENT_PATH`

<EnvVarConfig
    name="ELECTRIC_CLIENT_PATH"
    defaultValue="./src/generated/client"
    example="./src/electricClient"
>
  Path to the directory where the generated client code will be written.

  Used by the [`generate`](#generate) command.
</EnvVarConfig>

#### `ELECTRIC_SERVICE_HOST`

<EnvVarConfig
    name="ELECTRIC_SERVICE_HOST"
    defaultValue="localhost"
    example="electric.mydomain.com"
>
  Hostname the Electric service is running on.

  Used by the [`generate`](#generate) and [`psql`](#psql) commands.
</EnvVarConfig>

#### `ELECTRIC_WITH_POSTGRES`

<EnvVarConfig
    name="ELECTRIC_WITH_POSTGRES"
    defaultValue="true"
    example="false"
>
  Start a PostgreSQL database along with Electric.

  Used by the [`start`](#start) command.
</EnvVarConfig>

#### `ELECTRIC_DATABASE_URL`

<EnvVarConfig
    name="ELECTRIC_DATABASE_URL"
    defaultValue="postgresql://{ELECTRIC_DATABASE_USER}:{ELECTRIC_DATABASE_PASSWORD}@{ELECTRIC_DATABASE_HOST}:{ELECTRIC_DATABASE_PORT}/{ELECTRIC_DATABASE_NAME}"
    example="postgresql://postgres:db_password@electric.myhost.com:5432/electric-sql"
>
  PostgreSQL connection URL for the database.

  Used by the [`start`](#start) command.

  With all defaults, it evaluates to:
  `postgresql://postgres:db_password@localhost:5432/electric-sql`
</EnvVarConfig>

#### `ELECTRIC_DATABASE_HOST`

<EnvVarConfig
    name="ELECTRIC_DATABASE_HOST"
    defaultValue="localhost"
    example="electric.myhost.com"
>
  Hostname of the database server.

  Used by the [`start`](#start) command.
</EnvVarConfig>

#### `ELECTRIC_DATABASE_PORT`

<EnvVarConfig
    name="ELECTRIC_DATABASE_PORT"
    defaultValue="5432"
    example="5433"
>
  Port number of the database server.

  Used by the [`start`](#start) command.
</EnvVarConfig>

#### `ELECTRIC_DATABASE_USER`

<EnvVarConfig
    name="ELECTRIC_DATABASE_USER"
    defaultValue="postgres"
    example="my_db_user"
>
  Username to connect to the database with.

  Used by the [`start`](#start) command.
</EnvVarConfig>

#### `ELECTRIC_DATABASE_PASSWORD`

<EnvVarConfig
    name="ELECTRIC_DATABASE_PASSWORD"
    defaultValue="db_password"
    example="db_password"
>
  Password to connect to the database with.

  Used by the [`start`](#start) command.
</EnvVarConfig>

#### `ELECTRIC_DATABASE_NAME`

<EnvVarConfig
    name="ELECTRIC_DATABASE_NAME"
    defaultValue="electric"
    example="db_password"
>
  Name of the database to connect to.

  Used by the [`start`](#start) and [`psql`](#psql) commands.

  Defaults to the project name (i.e. `"name": "my-project-name"`) specified in your `package.json` file, falls back to `electric`.
</EnvVarConfig>

#### `ELECTRIC_HTTP_PORT`

<EnvVarConfig
    name="ELECTRIC_HTTP_PORT"
    defaultValue="5133"
    example="5144"
>
  Port for HTTP connections.

  Used by the [`start`](#start) command along with connecting to the sync service from your project client.
</EnvVarConfig>

#### `ELECTRIC_PG_PROXY_PORT`

<EnvVarConfig
    name="ELECTRIC_PG_PROXY_PORT"
    defaultValue="65432"
    example="65433"
>
  Port number for connections to the Postgres migration proxy.

  Used by the [`start`](#start) and [`psql`](#psql) commands.
</EnvVarConfig>

#### `ELECTRIC_PG_PROXY_PASSWORD`

<EnvVarConfig
    name="ELECTRIC_PG_PROXY_PASSWORD"
    defaultValue="proxy_password"
    example="my_password"
>
  Password to use when connecting to the Postgres proxy via psql or any other Postgres client.

  Used by the [`start`](#start) and [`psql`](#psql) commands.
</EnvVarConfig>

#### `ELECTRIC_IMAGE`

<EnvVarConfig
    name="ELECTRIC_PG_PROXY_PASSWORD"
    defaultValue="electricsql/electric:{version-tag}"
    example="electricsql/electric:0.8"
>
  The Docker image to use for Electric.

  Used by the [`start`](#start) command.

  Defaults to the matching minor version for the installed Electric client, so if you are using `electric-sql@0.8.2` the docker image tagged `electricsql/electric:0.8` (the latest in the `0.8.n` range) will be used.
</EnvVarConfig>

#### `ELECTRIC_POSTGRESQL_IMAGE`

<EnvVarConfig
    name="ELECTRIC_PG_PROXY_PASSWORD"
    defaultValue="postgres:14-alpine"
    example="postgres:16"
>
  The Docker image to use for the PostgreSQL database.

  Used by the [`start`](#start) command.

</EnvVarConfig>

#### `ELECTRIC_MODULE_RESOLUTION`

<EnvVarConfig
    name="ELECTRIC_MODULE_RESOLUTION"
    defaultValue="node"
    example="nodenext"
>
  The module resolution used for the project. The generated client will be compatible with this resolution scheme.
  
  If you are using `nodenext` as your `tsconfig.json` `moduleResolution` then settings this to `nodenext` also will ensure that the generated client is compatible with your TypeScript configuration.

  Used by the [`generate`](#generate) command.

</EnvVarConfig>
