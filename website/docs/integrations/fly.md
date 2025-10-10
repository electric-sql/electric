---
outline: deep
title: Fly.io - Integrations
description: >-
  How to deploy Electric on Fly.
image: /img/integrations/electric-fly.jpg
---

<img src="/img/integrations/fly.svg" class="product-icon" />

# Fly.io

[Fly.io](https://fly.io) is a public cloud built for developers who ship.

## Electric and Fly

You can use Fly to deploy any or all components of the Electric stack:

- [deploy a Postgres database](#deploy-postgres)
- [an Electric sync service](#deploy-electric)
- [your client application](#deploy-your-app)

One of Fly's specialities is deploying Elixir applications. So Fly is especially good for [deploying the Electric sync service](#deploy-electric) and/or [Phoenix applications](./phoenix) using Electric.

> [!Tip] Need context?
> See the [Deployment guide](/docs/guides/deployment) for more details.

### Deploy Postgres

[Fly Postgres](https://fly.io/docs/postgres) is not a managed Postgres service. See the general advice on [Running Postgres](/docs/guides/deployment#_1-running-postgres) in the deployment guide for information on how to configure Postgres to work with Electric.

Fly's [Supabase Postgres](https://fly.io/docs/supabase) is a managed Postgres service, powered by [Supabase](./supabase). If you use it, make sure to connect on the IPv6 `DATABASE_URL` rather than the `DATABASE_POOLER_URL`. See the [Supabase deployment docs](./supabase#deploy-postgres) and the IPv6 section of the [troubleshooting guide](/docs/guides/troubleshooting#ipv6-support) for more information about IPv6 support.

### Deploy Electric

Copy the following config into a file called `fly.toml`, replacing the app name and `DATABASE_URL`:

```toml
app = "YOUR_UNIQUE_APP_NAME"

[build]
  image = "electricsql/electric:latest"

[env]
  DATABASE_URL = "postgresql://..."
  ELECTRIC_DATABASE_USE_IPV6 = true

[http_service]
  internal_port = 3000
  force_https = true

  [[http_service.checks]]
    interval = "10s"
    timeout = "2s"
    grace_period = "20s"
    method = "GET"
    path = "/v1/health"
```

Using the [`flyctl` client](https://fly.io/docs/flyctl/install/), in the same directory as `fly.toml`, run:

```shell
flyctl launch --copy-config --ha=false
```

Hit the health check endpoint to verify that everything is running OK:

```console
$ curl https://YOUR_UNIQUE_APP_NAME.fly.dev/v1/health
{"status":"active"}
```

### Deploy your app

You can run most kinds of apps on Fly, including [static sites](https://fly.io/docs/languages-and-frameworks/static/).
