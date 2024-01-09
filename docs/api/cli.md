---
title: CLI & Generator
description: >-
  Command-line interface for the `npx electric-sql generate` script and other commands.
sidebar_position: 30
---

# CLI Commands

The Electric client library comes with a CLI providing a couple of helpful commands for building Electric apps:

- [`generate`](#generate) - The type-safe client generator; this command builds the client library for your applications to use.
- [`proxy-tunnel`](#proxy-tunnel) - A tool to enable you to connect to the Electric migrations proxy when it's deployed behind an restrictive firewall, or with a hosting provider, that only allows incoming HTTP connections.

These commands are all executed in the form `npx electric-sql [command-name]` from within a project where you have installed the [client library](../usage/installation/client).

## `generate`

To interface with your database from within a JavaScript or TypeScript application you need an Electric client (see <DocPageLink path="usage/data-access/client" /> for context). To generate an Electric client, make sure that your database and the Electric sync service are up and running.
Then, from within the root folder of your application run:

```shell
npx electric-sql generate
```

This will download all migrations from the database, bundle them with your application, and generate the Electric client.
Note that you can use an optional `--watch` flag to automatically re-generate the client on every database migration.

### Options

The generate command accepts a number of arguments:

```shell
npx electric-sql generate [--service <url>] [--proxy <url>] [--out <path>] [--watch [<pollingInterval>]]
```

All arguments are optional and are described below:

| Argument | Value | Description |
|----------|-------|-------------|
| <span className="no-wrap">`--service`</span> | `<url>` | Provides the url to connect to the Electric sync service. If not provided, it uses the url set in the `ELECTRIC_URL` environment variable. If that variable is not set, it resorts to the default url which is `http://localhost:5133`. |
| <span className="no-wrap">`--proxy`</span> | `<url>` | <p>Provides the url to connect to Electric's database proxy. If not provided, it uses the url set in the `ELECTRIC_PROXY_URL` environment variable. If that variable is not set, it resorts to the default url which is <span class="break-all">`postgresql://prisma:proxy_password@localhost:65432/electric`</span></p><div class="theme-admonition theme-admonition-caution alert alert--warning admonition_node_modules-@docusaurus-theme-classic-lib-theme-Admonition-styles-module"><div class="admonitionHeading_node_modules-@docusaurus-theme-classic-lib-theme-Admonition-styles-module"><span class="admonitionIcon_node_modules-@docusaurus-theme-classic-lib-theme-Admonition-styles-module"><svg viewBox="0 0 16 16"><path fill-rule="evenodd" d="M8.893 1.5c-.183-.31-.52-.5-.887-.5s-.703.19-.886.5L.138 13.499a.98.98 0 0 0 0 1.001c.193.31.53.501.886.501h13.964c.367 0 .704-.19.877-.5a1.03 1.03 0 0 0 .01-1.002L8.893 1.5zm.133 11.497H6.987v-2.003h2.039v2.003zm0-3.004H6.987V5.987h2.039v4.006z"></path></svg></span>caution</div><div class="admonitionContent_node_modules-@docusaurus-theme-classic-lib-theme-Admonition-styles-module"><p>Note that the username in the proxy URL <strong>must</strong> be <code>prisma</code>.</p><p>This is to activate the proxy mode that uses Prisma tooling for schema introspection. It does not mean that your Postgres database actually needs a <code>prisma</code> user.</p></div></div> |
| <span className="no-wrap">`--out`</span> | `<path>` | Specifies where to output the generated client. Defaults to `./src/generated/client` |
| <span className="no-wrap">`--watch`</span> | `<pollingInterval>` | Run the generator in watch mode. Accepts an optional polling interval (in milliseconds) which defines how often to poll Electric for database migrations. The default polling interval is 1000ms. |

Note that the `--watch` flag can be used with or without a polling interval:

```shell
npx electric-sql generate --watch
# or with an explicit polling interval
npx electric-sql generate --watch 5000
```

## `proxy-tunnel`

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

### Options

The proxy-tunnel command accepts a number of arguments:

```shell
npx electric-sql proxy-tunnel [--service <url>] [--local-port <port>]
```

All arguments are optional and are described below:

| Argument | Value | Description |
|----------|-------|-------------|
| <span className="no-wrap">`--service`</span> | `<url>` | Provides the url to connect to the Electric sync service. If not provided, it uses the url set in the `ELECTRIC_URL` environment variable. If that variable is not set, it resorts to the default url which is `http://localhost:5133`. |
| <span className="no-wrap">`--local-port`</span> | `<port>` | The local port to bind to; this will be forwarded to the Electric sync service, and defaults to `65432`. |