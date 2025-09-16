---
title: Quickstart
description: >-
  Get up-and-running with Electric and TanStack DB. Install, develop and deploy a super-fast, reactive web app, based on real-time sync of your Postgres data.
outline: [2,3]
---

<p class="intro-zap-container">
  <img src="/img/home/zap-with-halo.svg"
      alt="Electric zap with halo"
      class="intro-zap"
  />
</p>

# Quickstart

Let's make a super-fast, reactive web app using <span class="no-wrap-xs">[Electric with TanStack&nbsp;DB](/blog/2025/07/29/local-first-sync-with-tanstack-db)</span>.

<div style="max-width: 632px">

> [!Warning] ✨ Just want to see it in action?
> See the [app running here](https://quickstart.examples.electric-sql.com) or [fork it on StackBlitz](https://stackblitz.com/fork/github/electric-sql/quickstart).

</div>

## Get started

:::tabs
== Electric Cloud (default)

Run the starter script:

```shell
npx @electric-sql/start my-electric-app
```

Start the dev server:

```shell
pnpm dev
```

Open [https://localhost:5173](https://localhost:5173).

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

## Deploy your app

Claim the [Electric Cloud](/product/cloud) resources:

```shell
pnpm claim
```

Deploy the app to [Netlify](https://tanstack.com/start/latest/docs/framework/react/hosting#what-is-netlify):

```sh
pnpm deploy
```

Congratulations! You've shipped a super-fast, reactive web app!

== Docker Compose

... local docker content ...

== Manual install

... manual install flow ...

:::

## Next steps

<!-- - follow the [Tutorial](/docs/tutorial) to evolve your starter into a production-quality app. -->
- learn more about [Local-first sync with Electric and TanStack DB](/blog/2025/07/29/local-first-sync-with-tanstack-db)
- see the [Interactive guide to TanStack DB](https://frontendatscale.com/blog/tanstack-db).