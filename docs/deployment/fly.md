---
title: "Fly.io"
description: >-
  Deploy app servers close to your users.
sidebar_position: 40
---

You can deploy ElectricSQL to [Fly.io](https://fly.io).

The app config needs to include an `http_service` with internal port `5133` and a TCP service for Electric's [migrations proxy](../usage/data-modelling/migrations#migrations-proxy) that listens on port `65432` by default.

The environment variables used by Electric are described in <DocPageLink path="api/service" />.

## Deploying Electric

As a quick example, let's create a new Fly app to run Electric and connect it to a third-party database such as [Supabase](./supabase.md).

### Postgres with logical replication

Before deploying Electric, make sure you have a Postgres database hosted somewhere where Electric will be able to connect to it and that it has logical replication enabled. Many managed hosting providers support logical replication, see <DocPageLink path="usage/installation/postgres#hosting" /> for some options.

Retrieve your database's connection URI with password included and use it as the value of the `DATABASE_URL` variable in the next step.

### Configure your Fly app

Save the following snippet into a file named `fly.toml` somewhere on your computer, changing the `app` name as you see fit:

```toml
app = "electric-on-fly-test-app"

[build]
  image = "electricsql/electric"

[env]
  AUTH_MODE = "insecure"
  DATABASE_URL = "postgresql://..."
  ELECTRIC_WRITE_TO_PG_MODE = "direct_writes"
  PG_PROXY_PASSWORD = "proxy_password"

# The main Internet-facing service of Electric to which clients will be connecting.
[http_service]
  internal_port = 5133
  force_https = true

  [[http_service.checks]]
    interval = "10s"
    timeout = "1s"
    grace_period = "20s"
    method = "GET"
    path = "/api/status"

# Service definition for the migrations proxy that should be accessible on a separate TCP port.
[[services]]
  protocol = "tcp"
  internal_port = 65432

  [[services.ports]]
    port = 65432
    handlers = ["pg_tls"]
```

### Deploy!

In your terminal, navigate to the directory where `fly.toml` is located and run `fly launch --copy-config --ha=false`:

```text
$ fly launch --copy-config --ha=false
An existing fly.toml file was found for app electric-on-fly-test-app
Using build strategies '[the "electricsql/electric" docker image]'.
Remove [build] from fly.toml to force a rescan
Creating app in /path/to/fly-test-app
We're about to launch your app on Fly.io. Here's what you're getting:

Organization: Oleksii Sholik           (fly launch defaults to the personal org)
Name:         electric-on-fly-test-app (from your fly.toml)
Region:       Amsterdam, Netherlands   (this is the fastest region for you)
App Machines: shared-cpu-1x, 1GB RAM   (most apps need about 1GB of RAM)
Postgres:     <none>                   (not requested)
Redis:        <none>                   (not requested)

// highlight-next-line
? Do you want to tweak these settings before proceeding? No
Created app 'electric-on-fly-test-app' in organization 'personal'
Admin URL: https://fly.io/apps/electric-on-fly-test-app
Hostname: electric-on-fly-test-app.fly.dev
Wrote config file fly.toml
Validating /path/to/fly-test-app/fly.toml
Platform: machines
✓ Configuration is valid

==> Building image
Searching for image 'electricsql/electric' remotely...
image found: img_lj9x4d2z6lxpwo1k

Watch your deployment at https://fly.io/apps/electric-on-fly-test-app/monitoring

// highlight-next-line
? Would you like to allocate dedicated ipv4 and ipv6 addresses now? Yes
Allocated dedicated ipv4: 149.248.198.105
Allocated dedicated ipv6: 2a09:8280:1::37:bcca

This deployment will:
 * create 1 "app" machine

No machines in group app, launching a new machine
Finished launching new machines
-------
 ✔ Machine e784e1e2c642e8 [app] update finished: success
-------

Visit your newly deployed app at https://electric-on-fly-test-app.fly.dev/
```

:::caution
We don't _currently_ support multiple running Electric instances connected to the same database. So it's important to override Fly's default behaviour of creating two machines for a new app by passing the `--ha=false` flag to `fly launch`.
:::

Verify app's status using `fly app list`:

```shell
$ fly app list
NAME                    	OWNER   	STATUS  	PLATFORM	LATEST DEPLOY
electric-on-fly-test-app	personal	deployed	machines	1m5s ago
```

Verify that Electric has successfully initialized its connection to Postres:

```shell
$ curl https://electric-on-fly-test-app.fly.dev/api/status
Connection to Postgres is up!
```

## Preparing the client app

Let's see how to set up a client app to connect to the Electric sync service we've just deployed. Clone the source code repository to your machine and navigate to the basic example, as explained on [this page](../examples/basic#source-code).

### Apply migrations

Electric can work alongside any tooling you use to manage database migrations with. See the <DocPageLink path="integrations/backend" /> section of the docs for an overview of the most popular frameworks.

In this demo we'll use `@databases/pg-migrations` as it's already included in the basic example. Make sure you have installed all of the dependencies by running `npm install` once.

:::note
Electric requires database migrations to be applied via the migrations proxy, so instead of using the connection URL from `DATABASE_URL`, we build a custom one that includes the configured `PG_PROXY_PASSWORD` and the domain name of the deployed Electric sync service.
:::

Run `npx pg-migrations apply` to apply the migration included in the example to your database:

```shell
$ npx pg-migrations apply \
      --directory db/migrations \
      --database postgresql://postgres:proxy_password@electric-on-fly-test-app.fly.dev:65432/postgres
Applying 01-create_items_table.sql
Applied 01-create_items_table.sql
1 migrations applied
```

### Generate a type-safe client

Now that the database has one electrified table, we can [generate a type-safe client](../usage/data-access/client.md) from it. Use the same database connection URL as in the previous step but change the username to `prisma` (this is required for the schema introspection to work correctly).

```shell
$ npx electric-sql generate
      --service https://electric-on-fly-test-app.fly.dev
      --proxy postgresql://prisma:proxy_password@electric-on-fly-test-app.fly.dev:65432/postgres
Generating Electric client...
Successfully generated Electric client at: ./src/generated/client
Building migrations...
Successfully built migrations
```

### Start the app!

Now you should have everything ready to start the web app and have it connected to the Electric sync service deployed on Fly.

```shell
$ ELECTRIC_URL='wss://electric-on-fly-test-app.fly.dev' \
  SERVE=true \
  npm run build

> electric-sql-wa-sqlite-example@0.7.0 build
> node copy-wasm-files.js && node builder.js

Your app is running at http://localhost:3001
```
