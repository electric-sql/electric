---
outline: deep
title: Fly.io - Integrations
image: /img/integrations/electric-fly.jpg
---

<img src="/img/integrations/fly.svg" class="product-icon" />

# Fly.io

[Fly.io](https://fly.io) is a public cloud built for developers who ship.

## Electric and Fly

You *can* use Fly to deploy any or all components of the Electric stack:

- [deploy a Postgres database](#deploy-postgres)
- [an Electric sync service](#deploy-electric)
- [your client application](#deploy-your-app)

Fly's sweet spot is deploying Elixir applications, like the Electric sync service and/or [Phoenix aplications](./phoenix).

> [!Tip] Need context?
> See the [Deployment guide](/docs/guides/deployment) for more details.

### Deploy Postgres

Fly isn't really a managed Postgres host. They do offer [database hosting](https://fly.io/docs/database-storage-guides/#managed-database-services) but they prefer to offload it to other providers, such as [Supabase](./supabase).

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