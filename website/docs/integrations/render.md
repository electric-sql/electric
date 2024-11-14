---
outline: deep
title: Render - Integrations
description: >-
  How to deploy Electric on Render.
image: /img/integrations/electric-render.jpg
---

<img src="/img/integrations/render.svg" class="product-icon" />

# Render

[Render](https://render.com) is a cloud infrastructure and web hosting platform.

## Electric and Render

You can use Render to deploy [an Electric sync service](#deploy-electric) and [your client application](#deploy-your-app).

> [!Info] Postgres on Render and logical replication
> Render does provide [managed Postgres hosting](https://docs.render.com/postgresql). However, this [doesn't yet](https://feedback.render.com/features/p/allow-for-postgres-logical-replication) support logical replication, so you can't currently use Electric with it.
>
> If you need Postgres hosting to use with Render, [Neon](./neon) and [Supabase](./supabase) both work great.

> [!Tip] Need context?
> See the [Deployment guide](/docs/guides/deployment) for more details.

### Deploy Electric

Deploy Electric as a [Web Service](https://docs.render.com/web-services) using their [deploy from a container registry](https://docs.render.com/web-services#deploy-from-a-container-registry) option.

In the Render dashboard, create a new Web Service, select Existing Image and paste `electricsql/electric` as the image URL. Then on the next screen set a `DATABASE_URL` and [any other config](/docs/api/config) as environment variables.

You can also optionally enter `/v1/health` as the path for a health check.

Under "Advanced" make sure you add a Persistent Disk and set the Mount path to e.g.: `/var/electric`. Then also set the [`ELECTRIC_STORAGE_DIR` environment variable](/docs/api/config#storage-dir) to the same mount path, e.g.: `ELECTRIC_STORAGE_DIR=/var/electric`.

### Deploy your app

You can deploy your app on Render as a [Static Site](https://docs.render.com/static-sites). For example, you can deploy our [standalone-basic-example](https://github.com/electric-sql/standalone-basic-example) by:

- selecting "Public GitHub Repository" and pasting `https://github.com/electric-sql/standalone-basic-example` as the value
- setting the publish directory to `dist`
- setting a `VITE_ELECTRIC_URL` environment variable to the URL of your Electric web service, such as `https://YOUR_WEB_SERVICE_NAME.onrender.com`

Then make sure that your Postgres database has an `items` table with an `id` column and insert some data into it.

## Example

Render supports [Blueprints](https://docs.render.com/infrastructure-as-code) to deploy infrastructure as code. The following example shows how to deploy Electric and an example web app that connects to it.

> [!Warning] Requires an existing Postgres running somewhere else
> The Blueprint above requires a `DATABASE_URL` to an existing Postgres database hosted somewhere else.
>
> Also, as per [the example above](#deploy-your-app), the example app it deploys assumes you have an `items` table in your database.

### `render.yaml` Blueprint

Clone [github.com/electric-sql/render-blueprint](https://github.com/electric-sql/render-blueprint) or copy the following config into a `render.yaml` file:

```yaml
services:
  - type: web
    runtime: image
    name: electric
    image:
      url: electricsql/electric:latest
    disk:
      name: storage
      mountPath: /var/electric
      sizeGB: 20
    envVars:
      - key: DATABASE_URL
        sync: false
      - key: ELECTRIC_STORAGE_DIR
        value: "/var/electric"
  - type: web
    runtime: static
    name: app
    buildCommand: VITE_ELECTRIC_URL="https://${ELECTRIC_HOST}.onrender.com" npm run build
    staticPublishPath: ./dist
    envVars:
      - key: ELECTRIC_HOST
        fromService:
          name: electric
          type: web
          property: host
```

You can then follow [the instructions here](https://docs.render.com/infrastructure-as-code#setup) to deploy the Blueprint on Render.

In short, you push the `render.yaml` to a repo, open the [Render Dashboard](https://dashboard.render.com/), click "New > Blueprint", connect the repo and enter your `DATABASE_URL` when prompted.