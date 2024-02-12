---
title: "Fly.io"
description: >-
  Deploy app servers close to your users.
sidebar_position: 40
---

You can deploy ElectricSQL to [Fly.io](https://fly.io) and use either an external Postgres or an instance of Fly Postgres as the database for the sync service. This guide covers both scenarios:

  1. Deploying Electric sync service and connecting it to an external Postgres.
  2. Configuring Fly Postgres and Electric sync service to connect over Fly's private network.

:::info
For background on how to successfully deploy the sync service and what needs to connect where, see <DocPageLink path="deployment/concepts" />.
:::

## Deploying Electric connected to an external Postgres

Before deploying Electric, you'll need a Postgres database (with logical replication enabled) hosted somewhere Electric can connect to. Many managed database providers support logical replication, see <DocPageLink path="usage/installation/postgres#hosting" /> for some options. Retrieve your database's connection URI with password included from your provider and use it as the value of the `DATABASE_URL` variable when setting up the app.

### Configure your Fly app

The app config needs to include an `http_service` with internal port `5133` and a TCP service for Electric's [migrations proxy](../usage/data-modelling/migrations#migrations-proxy) that listens on port `65432` by default.  See <DocPageLink path="api/service" /> to learn about the environment variables used by Electric in detail.

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

# The main Internet-facing service of Electric
# to which clients will be connecting.
[http_service]
  internal_port = 5133
  force_https = true

  [[http_service.checks]]
    interval = "10s"
    timeout = "1s"
    grace_period = "20s"
    method = "GET"
    path = "/api/status"

# Service definition for the migrations proxy that runs
# on a separate TCP port.
[[services]]
  protocol = "tcp"
  internal_port = 65432

  [[services.ports]]
    port = 65432
    handlers = ["pg_tls"]
```

:::info Secrets and environment variables
[Secrets](https://fly.io/docs/reference/secrets/) allow sensitive values, such as credentials, to be passed securely to your Fly app. The secret is encrypted and stored in a vault. It is made available to the app as an environment variable.

We're not using secrets in this example to keep things short and simple. As soon as you're ready to take your Fly app from development to production, make sure to replace the `DATABASE_URL`, `PG_PROXY_PASSWORD` and `AUTH_JWT_KEY` environment variables with secrets.

See also <DocPageLink path="usage/auth/secure"/> to learn about the secure authentication mode for your production-ready deployment of Electric.
:::

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


## Deploying Electric connected to Fly Postgres

Follow the [offical Fly Postgres docs](https://fly.io/docs/postgres/) to set up your database. If you already have an instance of Fly Postgres running, make sure it's configured with `wal_level=logical`:

```shell
$ fly pg -a <pg app name> config update --wal-level logical

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

Now go back to [Configure your Fly app](#configure-your-fly-app) above and modify the contents of the `fly.toml` file shown there by changing the `DATABASE_URL` value to use your Fly Postgres instance's connection string and adding the `DATABASE_REQUIRE_SSL` environment variable:


```toml
[env]
  DATABASE_URL = "postgres://postgres:...@<pg-app-name>.flycast:5432"
  DATABASE_REQUIRE_SSL = "false"
  ...the rest of the env vars
```

Fly Postgres does not support encrypted database connections inside its private 6PN network while Electric enforces encryption by default. The above `DATABASE_REQUIRE_SSL` setting changes Electric's behaviour by allowing it to fallback to using unencrypted connections.

