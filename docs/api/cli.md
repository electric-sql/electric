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
- [`start`](#start) - Start an ElectricSQL sync service for development, along with an optional PostgreSQL
- [`stop`](#stop) - Stop the development ElectricSQL sync service, and any optional PostgreSQL
- [`status`](#status) - Show status of the development ElectricSQL sync service docker containers
- [`psql`](#psql) - Connect with psql to the ElectricSQL PostgreSQL proxy
- [`configure-ports`](#configure-ports) - Configure the ports used by the ElectricSQL sync service
- [`show-config`](#show-config) - Show the current configuration
- [`with-config`](#with-config) - Run a sub command with config arguments substituted
- [`help`](#help) - Display help for a command

These commands are all executed in the form `npx electric-sql [command-name]` from within a project where you have installed the [client library](../usage/installation/client).

All commands accept both arguments or environment variables for configuration, and the CLI uses [dotenv-flow](https://www.npmjs.com/package/dotenv-flow) to load environment variables from `.env` files. See a [full list of environment variables](#environment-variables).

## Commands

#### `generate`

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
| <span className="no-wrap">`--service`</span><br/><span className="no-wrap">`-s`</span><br/>`ELECTRIC_SERVICE` |`<url>` | Provides the url to connect to the Electric sync service.<br /> Defaults to `http://localhost:5133`. |
| <span className="no-wrap">`--proxy`</span><br/><span className="no-wrap">`-p`</span><br/>`ELECTRIC_PROXY` | `<url>` | Provides the url to connect to Electric's database proxy.<br /> Defaults to <span class="break-all">`postgresql://prisma:proxy_password@localhost:65432/electric`</span>. <div class="theme-admonition theme-admonition-caution alert alert--warning admonition_node_modules-@docusaurus-theme-classic-lib-theme-Admonition-styles-module"><div class="admonitionHeading_node_modules-@docusaurus-theme-classic-lib-theme-Admonition-styles-module"><span class="admonitionIcon_node_modules-@docusaurus-theme-classic-lib-theme-Admonition-styles-module"><svg viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8.893 1.5c-.183-.31-.52-.5-.887-.5s-.703.19-.886.5L.138 13.499a.98.98 0 0 0 0 1.001c.193.31.53.501.886.501h13.964c.367 0 .704-.19.877-.5a1.03 1.03 0 0 0 .01-1.002L8.893 1.5zm.133 11.497H6.987v-2.003h2.039v2.003zm0-3.004H6.987V5.987h2.039v4.006z"></path></svg></span>caution</div><div class="admonitionContent_node_modules-@docusaurus-theme-classic-lib-theme-Admonition-styles-module"><p>Note that the username in the proxy URL <strong>must</strong> be <code>prisma</code>.</p><p>This is to activate the proxy mode that uses Prisma tooling for schema introspection. It does not mean that your Postgres database actually needs a <code>prisma</code> user.</p></div></div> |
| <span className="no-wrap">`--client-path`</span><br /><span className="no-wrap">`-o`</span><br />`ELECTRIC_CLIENT_PATH` | `<path>` | Specifies the output location for the generated client. Defaults to `./src/generated/client` |
| <span className="no-wrap">`--watch`</span><br /><span className="no-wrap">`-w`</span> | `<pollingInterval>` | Run the generator in watch mode. Accepts an optional polling interval (in milliseconds) which defines how often to poll Electric for database migrations.<br /> The default polling interval is 1000ms. |
| <span className="no-wrap">`--with-migrations`</span> | `<command>` | Specify a command to generate migrations. With this option the work flow is:<br /> 1. Start new ElectricSQL and PostgreSQL containers<br /> 2. Run the provided migrations command<br /> 3. Generate the client<br /> 4. Stop and remove the containers.<br /> See the [`with-config`](#with-config) command for details. |

For a full list of arguments run `npx electric-sql help generate` or see the [environment variables](#environment-variables) below.

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

Starts an ElectricSQL sync service (using Docker) for development, along with an optional PostgreSQL database.

By default it will launch a sync service that is compatible with the client version you have installed.

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
| <span className="no-wrap">`--with-postgres`</span> |  | Start a PostgreSQL database along with Electric.
| <span className="no-wrap">`--detach`</span> |  | Run in the background instead of printing logs to the console.
| <span className="no-wrap">`--database-url`</span><br/><span className="no-wrap">`-db`</span><br/>`ELECTRIC_DATABASE_URL` | `<url>` | PostgreSQL connection URL for the database. |
| <span className="no-wrap">`--http-port`</span><br />`ELECTRIC_HTTP_PORT` | `<port>` | The local port to run the sync service on. Defaults to 5133 |
| <span className="no-wrap">`--pg-proxy-port`</span><br />`ELECTRIC_PG_PROXY_PORT` | `<port>` | The local port to bind the Postgres Proxy port to. Defaults to 65432 |
| <span className="no-wrap">`--image`</span><br />`ELECTRIC_IMAGE` | `<image>` | The Docker image to use for Electric. |
| <span className="no-wrap">`--postgresql-image`</span><br />`ELECTRIC_POSTGRESQL_IMAGE` | `<image>` | The Docker image to use for the PostgreSQL database. |

For a full list of arguments run `npx electric-sql help start` or see the [environment variables](#environment-variables) below.

### `stop`

Stop the development ElectricSQL sync service that was started with the [`start`](#start) command, and any optional PostgreSQL.

```shell
npx electric-sql stop [--remove]
```

#### Options

The `start` command accepts a single argument:

| Argument             | Description                              |
|----------------------|------------------------------------------|
| <span className="no-wrap">`--remove`</span> | Remove the containers and volumes from Docker.

### `status`

Show status of the ElectricSQL sync service docker containers that were started with the [`start`](#start) command.

```shell
npx electric-sql status
```

### `psql`

Connect with psql to the ElectricSQL PostgreSQL proxy.

```shell
npx electric-sql psql [--proxy <url>]
```

#### Options

The `psql` command accepts a number of arguments for specifying the Postgres Proxy to connect to, the main one being:

| Argument or Env var  | Value        | Description                              |
|----------------------|--------------|------------------------------------------|
| <span className="no-wrap">`--proxy`</span><br /><span className="no-wrap">`-p`</span><br />`ELECTRIC_PROXY` | `<url>` | URL of the Electric service's PostgreSQL proxy.

For a full list of arguments run `npx electric-sql help psql` or see the [environment variables](#environment-variables) below.

### `configure-ports`

Configure the ports used by the ElectricSQL sync service.

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

It takes a single string argument, which is the command to run in string form:

```shell
npx electric-sql with-config <command>
```

To substitute a configuration value in the sub command use the environment variable name inside double braces:

```shell
npx electric-sql with-config "subcommand --an-argument {{ELECTRIC_PROXY}} --something"
```

One of the main use cases for this command is running migrations against your Electric Postgres Proxy using the configuration specified locally. Many of our examples use the [@databases/pg-migrations](https://www.atdatabases.org/docs/pg-migrations) tool for migrations, and we run the migrations with:

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

The [`generate`](#generate) command takes an optional `--with-migrations` command that also takes the same argument form as the `with-config` command. With this you can run:

```shell
npx electric-sql generate --with-migrations "npx pg-migrations apply --database {{ELECTRIC_PROXY}} --directory ./db/migrations"
```

This will perform these tasks, allowing you to generate a client directly from a set of migrations:

1. Start new ElectricSQL and PostgreSQL containers
2. Run the provided migrations command
3. Generate the client
4. Stop and remove the containers

### `help`

Display the help for a command.

```shell
npx electric-sql help <command>
```

## Environment Variables

In addition to those specified below, all standard Electric sync service environment variables are available for setting prefixed with `ELECTRIC_`. These are then passed though to the sync service started with the [`start`](#start) command. See a [full list of environment variables here](./service.md#configuration-options).

#### `ELECTRIC_SERVICE`

URL of the Electric service.

Used by the [`generate`](#generate) command.

Defaults to `http://{ELECTRIC_SERVICE_HOST}:{ELECTRIC_HTTP_PORT}`

With all defaults, it evaluates to `http://localhost:5133`

This environment variable is perfect for configuring the Electric client in your project. 

```typescript
import { schema } from './generated/client'

const conn = await ElectricDatabase.init(scopedDbName)
const electric = await electrify(conn, schema, {
  url: import.meta.env.ELECTRIC_SERVICE
  // ...
})
```

#### `ELECTRIC_PROXY`

URL of the Electric service's PostgreSQL proxy.

Used by the [`generate`](#generate) and [`psql`](#psql) commands.

Defaults to:

```
postgresql://postgres:{ELECTRIC_PG_PROXY_PASSWORD}@{ELECTRIC_SERVICE_HOST}:{ELECTRIC_PG_PROXY_PORT}/{ELECTRIC_DATABASE_NAME}
```

With all defaults, it evaluates to:

```
postgresql://postgres:proxy_password@localhost:65432/electric
```

#### `ELECTRIC_CLIENT_PATH`

Path to the directory where the generated client code will be written.

Used by the [`generate`](#generate) command.

Defaults to `./src/generated/client`

#### `ELECTRIC_SERVICE_HOST`

Hostname the Electric service is running on.

used by the [`generate`](#generate) and [`psql`](#psql) commands.

Defaults to `localhost`

#### `ELECTRIC_WITH_POSTGRES`

Start a PostgreSQL database along with Electric.

Used by the [`start`](#start) command.

#### `ELECTRIC_DATABASE_URL`

PostgreSQL connection URL for the database.

Used by the [`start`](#start) command.

Defaults to:

```
postgresql://{ELECTRIC_DATABASE_USER}:{ELECTRIC_DATABASE_PASSWORD}@{ELECTRIC_DATABASE_HOST}:{ELECTRIC_DATABASE_PORT}/{ELECTRIC_DATABASE_NAME}
```

With all defaults, it evaluates to:

```
postgresql://postgres:db_password@localhost:5432/electric-sql
```

#### `ELECTRIC_DATABASE_HOST`

Hostname of the database server.

Used by the [`start`](#start) command.

Defaults to `localhost`

#### `ELECTRIC_DATABASE_PORT`

Port number of the database server.

Used by the [`start`](#start) command.

Defaults to `5432`

#### `ELECTRIC_DATABASE_USER`

Username to connect to the database with.

Used by the [`start`](#start) command.

Defaults to `postgres`

#### `ELECTRIC_DATABASE_PASSWORD`

Password to connect to the database with.

Used by the [`start`](#start) command.

Defaults to `db_password`

#### `ELECTRIC_DATABASE_NAME`

Name of the database to connect to.

Used by the [`start`](#start) and [`psql`](#psql) commands.

Defaults to the project name (i.e. `"name": "my-project-name"`) specified in your `package.json` file, falls back to `electric`.

#### `ELECTRIC_HTTP_PORT`

Port for HTTP connections.

Used by the [`start`](#start) command along with connecting to the sync service from your project client.

Defaults to `5133`

#### `ELECTRIC_PG_PROXY_PORT`

Port number for connections to the Postgres migration proxy.

Used by the [`start`](#start) and [`psql`](#psql) commands.

Defaults to `65432`

#### `ELECTRIC_PG_PROXY_PASSWORD`

Password to use when connecting to the Postgres proxy via psql or any other Postgres client.

Used by the [`start`](#start) and [`psql`](#psql) commands.

Defaults to `proxy_password`

#### `ELECTRIC_IMAGE`

The Docker image to use for Electric.

Used by the [`start`](#start) command.

Defaults to the matching minor version for the installed ElectricSQL client, so if you are using `electric-sql@0.8.2` the docker image tagged `electricsql/electric:0.8` (the latest in the `0.8.n` range) will be used.

#### `ELECTRIC_POSTGRESQL_IMAGE`

The Docker image to use for the PostgreSQL database.

Used by the [`start`](#start) command.

Defaults to `postgres:14-alpine`
