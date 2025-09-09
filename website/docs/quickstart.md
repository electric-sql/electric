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

Let's make a super-fast, reactive web app <span class="no-wrap-xs">using [Electric](/product/electric) with [TanStack&nbsp;DB](#product/tanstack-db)</span>.

<div style="max-width: 632px">

> [!Warning] ✨ Just want to see it in action?
> See the [app running here](https://quickstart.examples.electric-sql.com) or [fork it on StackBlitz](https://stackblitz.com/fork/github/electric-sql/quickstart).

</div>

:::tabs
== Electric Cloud (default)

Run the starter script:

```shell
pnpx @electric-sql/start my-electric-app
```

This generates a [TanStack Start](https://tanstack.com/start/latest/docs/framework/react/overview) app in `my-electric-app` and runs a [Postgres database](https://electric-sql.com/docs/guides/deployment#_1-running-postgres) and [Electric sync service](https://electric-sql.com/docs/guides/deployment#_2-running-electric) for you in the [Electric Cloud](/product/cloud).

You can then run the app locally using:

```shell
pnpm dev
```

Open in your web browser at [localhost:5173](http://localhost:5173).

### Postgres sync

Lets change some data in Postgres and see the app instantly react.

Connect to Postgres using `psql`:

```shell
pnpm dev
```

- [ ] connect to the DB using the DATABASE_URL in `.env`
- [ ] manually edit the data and see the app update

### Develop the app

- [ ] change the code and see what happens
- [ ] load the AGENTS.md into your LLM and have it make changes
- [ ] see the blog post on developing with Electric and TanStack DB and the Interactive Guide to TanStack DB for a high level intro on the stack
- [ ] dive into the Tutorial for more in depth

### Claim the resources

- [ ] claim the resources

### Deploy and share

- [ ] deploy the app

== Docker Compose

... local docker content ...

== Manual install

... manual install flow ...

:::
