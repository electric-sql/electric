---
title: "Fly.io"
description: >-
  Deploy app servers close to your users.
sidebar_position: 40
---

You can deploy ElectricSQL to [Fly.io](https://fly.io).

The app config needs to include an `http_service` with internal port `5133`. Electric also listens on ports `5433` and `65432` but those **should not** be exposed to the Internet unless your Postgres database or the tooling you'll be using for running migrations is hosted outside of [Fly's private network](https://fly.io/docs/reference/private-networking/).

The environment variables used by Electric are described in <DocPageLink path="api/service" />.

## Deploying Electric

As a quick example, let's create a new Fly app to run Electric and connect it to a [Fly Postgres](https://fly.io/docs/postgres/) instance.

### Postgres with logical replication

Before we start, make sure you have an instance of Fly Postgres deployed:

```shell
$ fly pg create

[...]

Postgres cluster ancient-pine-7827 created
  Username:    postgres
  Password:    ******
  Hostname:    ancient-pine-7827.internal
  Flycast:     fdaa:3:606e:0:1::3
  Proxy port:  5432
  Postgres port:  5433
  Connection string: postgres://postgres:******@ancient-pine-7827.flycast:5432

Save your credentials in a secure place -- you won't be able to see them again!
```

And configured with `wal_level=logical`:

```shell
$ fly pg -a ancient-pine-7827 config update --wal-level logical

NAME     	VALUE  	TARGET VALUE	RESTART REQUIRED
wal-level	replica	logical     	true

// highlight-next-line
? Are you sure you want to apply these changes? Yes
Performing update...
Update complete!
Please note that some of your changes will require a cluster restart
before they will be applied.
// highlight-next-line
? Restart cluster now? Yes
Identifying cluster role(s)
  Machine 148ed127a03de8: primary
Restarting machine 148ed127a03de8
  Waiting for 148ed127a03de8 to become healthy (started, 1/3)
```

Keep the connection URL handy, we will need it soon for the Electric sync service.

### Configure your app

Save the following snippet into a file named `fly.toml` somewhere on your computer, changing the `app` name and `primary_region` as you see fit:

```toml
app = "electric-on-fly-test-app"
primary_region = "otp"

[build]
  image = "electricsql/electric:latest"

[env]
  AUTH_MODE = "insecure"
  DATABASE_USE_IPV6 = "true"
  ELECTRIC_USE_IPV6 = "true"
  LOGICAL_PUBLISHER_HOST = "electric-on-fly-test-app.internal"

[http_service]
  internal_port = 5133
  force_https = true
```

:::caution
The `LOGICAL_PUBLISHER_HOST` should correspond to your choice of app name.

If you change your app name in your `fly.toml`, make sure you change the `LOGICAL_PUBLISHER_HOST` value as well.
:::

:::tip
You may omit the `primary_region` option from `fly.toml` and instead pick a region from an interactive prompt later.
:::

In your terminal, navigate to the directory where `fly.toml` is located and run `fly launch`, answering "no" to prompts to deploy accompanying services:

```shell
$ fly launch

Creating app in /path/to/fly-test-app
An existing fly.toml file was found for app electric-on-fly-test-app
// highlight-next-line
? Would you like to copy its configuration to the new app? Yes
Using build strategies '[the "electricsql/electric:0.7" docker image]'.
Remove [build] from fly.toml to force a rescan
// highlight-next-line
? Choose an app name (leaving blank will default to 'electric-on-fly-test-app')
automatically selected personal organization: ElectricSQL
App will use 'otp' region as primary

Created app 'electric-on-fly-test-app' in organization 'personal'
Admin URL: https://fly.io/apps/electric-on-fly-test-app
Hostname: electric-on-fly-test-app.fly.dev
// highlight-next-line
? Would you like to set up a Postgresql database now? No
// highlight-next-line
? Would you like to set up an Upstash Redis database now? No
Wrote config file fly.toml
// highlight-next-line
? Would you like to deploy now? No
Validating /path/to/fly-test-app/fly.toml
Platform: machines
✓ Configuration is valid
Your app is ready! Deploy with `flyctl deploy`
```

### Set secrets

Some configuration settings are not meant to be viewed casually and should instead be stored away from prying eyes. We call such settings secrets. The following Electric settings should be set as secrets:

- `AUTH_JWT_KEY` - the signing key for auth tokens, required when `AUTH_MODE=secure`
- `DATABASE_URL` - the database connection string that includes the password
- `PG_PROXY_PASSWORD` - the password you configure to protect access to Electric's migrations proxy

In our example we're using `AUTH_MODE=insecure`, so we only need to set values for the latter two secrets. Make sure you pass the `--stage` flag to `fly secrets set`, this will prevent Fly from redeploying the app every time:

```shell
$ fly secrets set --stage \
      DATABASE_URL="postgresql://postgres:******@ancient-pine-7827.internal:5432/postgres" \
      PG_PROXY_PASSWORD="******"
Secrets have been staged, but not set on VMs. Deploy or update machines in this app for the secrets to take effect.
```

:::info
Double-check that your value for `DATABASE_URL` starts with `postgresql://` and ends with the database name, e.g. `/postgres`.
:::

### Deploy!

Now we're ready to deploy Electric to Fly!

```shell
$ fly deploy --ha=false

==> Verifying app config
Validating /path/to/fly-test-app/fly.toml
Platform: machines
✓ Configuration is valid
--> Verified app config
==> Building image
Searching for image 'electricsql/electric:0.7' remotely...
image found: img_589kp9xlz7ypoj2e

Watch your deployment at https://fly.io/apps/electric-on-fly-test-app/monitoring

Provisioning ips for electric-on-fly-test-app
  Dedicated ipv6: 2a09:8280:1::37:a226
  Shared ipv4: 66.241.124.92
  Add a dedicated ipv4 with: fly ips allocate-v4

This deployment will:
 * create 1 "app" machine

No machines in group app, launching a new machine
Finished launching new machines
-------

Visit your newly deployed app at https://electric-on-fly-test-app.fly.dev/
```

:::caution
We don't *currently* support multiple running Electric instances connected to the same database. So it's important to override Fly's default behaviour of creating two machines for a new app by passing the `--ha=false` flag.
:::

Verify that it's up:

```shell
$ curl https://electric-on-fly-test-app.fly.dev/api/status
Connection to Postgres is up!
```

## Preparing the client app

Let's see how to set up a client app to connect to the Electric sync service we've just deployed. Clone the source code repository to your machine and navigate to the basic example, as explained on [this page](../../examples/basic#source-code).

### Configure your Private Network VPN

In a real-world scenario, you would apply database migrations to the production database in the same environment where your app is deployed. For this example, though, we're executing commands on a local machine. Therefore we need to set up a WireGuard VPN to reach both the app and the Postgres instance deployed on Fly. Follow the [official instructions](https://fly.io/docs/reference/private-networking/#private-network-vpn) to complete the setup on your machine.

### Apply migrations

Electric can work alongside any tooling you use to manage database migrations with. See the <DocPageLink path="integrations/backend" /> section of the docs for an overview of the most popular frameworks.

In this demo we'll use `@databases/pg-migrations` as it's already included in the basic example. Make sure you have installed all of the dependencies by running `yarn` once.

:::note
Electric requires database migrations to be applied via the migrations proxy, so instead of using the connection URL we got earlier from `fly pg create`, we build a custom one that includes the configured `PG_PROXY_PASSWORD` and the domain name of the deployed Electric sync service.
:::

Run `npx pg-migrations apply` to apply the migration included in the example to your database:

```shell
$ npx pg-migrations apply \
      --directory db/migrations \
      --database postgresql://postgres:*****@electric-on-fly-test-app.internal:65432/postgres
Applying 01-create_items_table.sql
Applied 01-create_items_table.sql
1 migrations applied
```

### Generate a type-safe client

Now that the database has one electrified table, we can [generate a type-safe client](../../usage/data-access-client.mdx) from it. Use the same database connection URL as in the previous step but change the username to `prisma` (this is required for the schema introspection to work correctly).

```shell
$ npx electric-sql generate
      --service http://electric-on-fly-test-app.internal:5133
      --proxy postgresql://prisma:******@electric-on-fly-test-app.internal:65432/electric
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
