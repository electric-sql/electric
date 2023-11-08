---
title: Generator script
description: >-
  Command-line interface for the `npx electric-sql generate` script.
sidebar_position: 30
---

# Generator script

To interface with your database from within a JavaScript or TypeScript application you need an Electric client (see <DocPageLink path="usage/data-access/client" /> for context). To generate an Electric client, make sure that your database and the Electric sync service are up and running.
Then, from within the root folder of your application run:

```shell
npx electric-sql generate
```

This will download all migrations from the database, bundle them with your application, and generate the Electric client.
Note that you can use an optional `--watch` flag to automatically re-generate the client on every database migration.

## Options

The generate script accepts a number of arguments:

```shell
npx electric-sql generate [--service <url>] [--proxy <url>] [--out <path>] [--watch [<pollingInterval>]]
```

All arguments are optional and are described below:

| Argument | value | description |
|----------|-------|-------------|
| <span className="no-wrap">`--service`</span> | `<url>` | Provides the url to connect to the Electric sync service. If not provided, it uses the url set in the `ELECTRIC_URL` environment variable. If that variable is not set, it resorts to the default url which is `http://localhost:5133`. |
| <span className="no-wrap">`--proxy`</span> | `<url>` | Provides the url to connect to Electric's database proxy. If not provided, it uses the url set in the `PG_PROXY_URL` environment variable. If that variable is not set, it resorts to the default url which is `postgresql://prisma:proxy_password@localhost:65432/electric`. |
| <span className="no-wrap">`--out`</span> | `<path>` | Specifies where to output the generated client. Defaults to `./src/generated/client` |
| <span className="no-wrap">`--watch`</span> | `<pollingInterval>` | Run the generator in watch mode. Accepts an optional polling interval (in milliseconds) which defines how often to poll Electric for database migrations. The default polling interval is 1000ms. |

Note that the `--watch` flag can be used with or without a polling interval:

```shell
npx electric-sql --watch
# or with an explicit polling interval
npx electric-sql --watch 5000
```
