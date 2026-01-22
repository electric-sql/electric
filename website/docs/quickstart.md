---
title: Quickstart
description: >-
  Get up-and-running with Electric and TanStack DB. Install, develop and deploy a super-fast, reactive web app, based on real-time sync of your Postgres data.
outline: 2
---

<p class="intro-zap-container">
  <img src="/img/home/zap-with-halo.svg"
      alt="Electric zap with halo"
      class="intro-zap"
  />
</p>

# Quickstart

Let's make a super-fast, reactive web app using <span class="no-wrap-xs">[Electric with TanStack&nbsp;DB](/blog/2025/07/29/super-fast-apps-on-sync-with-tanstack-db)</span>.

<div style="max-width: 632px">

> [!Warning] ✨ Just want to see it in action?
> See the [app running here](https://quickstart.examples.electric-sql.com) or [fork it on StackBlitz](https://stackblitz.com/fork/github/electric-sql/electric/tree/main/examples/tanstack-db-web-starter).

</div>

## Setup

You'll need [Node](https://nodejs.org/en), [pnpm](https://pnpm.io) and [Caddy](https://caddyserver.com) installed. If you haven't used Caddy before, you'll need to install it's [root certificate](https://caddyserver.com/docs/command-line#caddy-trust) using:

```sh
caddy trust # may require sudo
```

<small><em>Why Caddy? Electric [uses HTTP/2](https://electric-sql.com/docs/guides/troubleshooting#slow-shapes-mdash-why-are-my-shapes-slow-in-the-browser-in-local-development). Caddy enables HTTP/2 in local development.</em></small>

## Get started

:::tabs
== Cloud (default)

Run the starter script:

```shell
npx @electric-sql/start my-electric-app
```

Start the dev server:

```shell
pnpm dev
```

Open [https://localhost:5173](https://localhost:5173).

### See the real-time sync

In another terminal, connect to Postgres using `psql`:

```shell
pnpm psql
```

Update the project name:

```sql
UPDATE projects SET name = 'Baz bam!';
```

The app updates instantly in real-time &mdash; across all users and devices.

### Develop your app

The starter is a fully-fledged [TanStack Start](https://tanstack.com/start/latest/docs/framework/react/overview) app with routing and auth.

You can edit the code manually. Or it has an `AGENTS.md` file you can load directly into your AI code editor:

```sh
claude "Read Agents.md. Sort the project page todo list alphabetically."
```

See the [starter template README](https://github.com/electric-sql/electric/blob/main/examples/tanstack-db-web-starter/README.md#developing-your-app) for more details.

### Deploy your app

Claim the [Electric Cloud](/cloud) resources:

```shell
pnpm claim
```

Deploy the app, for example to [Netlify](https://tanstack.com/start/latest/docs/framework/react/hosting#what-is-netlify):

```sh
pnpm deploy
```

Congratulations! You've shipped a super-fast, reactive web app based on real-time sync!

== Docker

You can also run the [starter template](https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-web-starter) with local backend services in Docker:

```sh
npx gitpick electric-sql/electric/tree/main/examples/tanstack-db-web-starter my-electric-app
cd my-electric-app
```

Copy the `.env.example` file to `.env`:

```sh
cp .env.example .env
```

Install the dependencies:

```sh
pnpm install
```

Start Postgres and Electric running as background services using Docker Compose:

```sh
pnpm backend:up
```

Apply the database migrations:

```sh
pnpm migrate
```

Start the dev server:

```sh
pnpm dev
```

Open the application on [https://localhost:5173](https://localhost:5173).

## See the real-time sync

In another terminal, connect to Postgres using `psql`:

```shell
pnpm psql
```

Update the project name:

```sql
UPDATE projects SET name = 'Baz bam!';
```

The app updates instantly in real-time &mdash; across all users and devices.

## Develop your app

The starter is a fully-fledged [TanStack Start](https://tanstack.com/start/latest/docs/framework/react/overview) app with routing and auth.

You can edit the code manually. Or it has an `AGENTS.md` file you can load directly into your AI code editor:

```sh
claude "Read Agents.md. Sort the project page todo list alphabetically."
```

See the [starter template README](https://github.com/electric-sql/electric/blob/main/examples/tanstack-db-web-starter/README.md#developing-your-app) for more details.

:::

## Next steps

<!-- - follow the [Tutorial](/docs/tutorial) to evolve your starter into a production-quality app. -->
- learn more about [Local-first sync with Electric and TanStack DB](/blog/2025/07/29/super-fast-apps-on-sync-with-tanstack-db)
- see the [Interactive guide to TanStack DB](https://frontendatscale.com/blog/tanstack-db).