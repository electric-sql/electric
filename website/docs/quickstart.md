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

Arrange your windows so you can see the app running in your web browser and your terminal at the same time. Open the "Default" project page in the browser.

Then in your terminal, connect to Postgres using `psql`:

```shell
pnpm psql
```

This will open the psql shell:

```
psql (17.4, server 17.6)
Type "help" for help.

electric=#
```

Update the project name:

```sql
UPDATE projects SET name = 'Baz bam!';
```

Keep changing the project name. The app updates instantly in real-time &mdash; for all users.

### Develop the app

The starter app is a fully-fledged [TanStack Start](https://tanstack.com/start) application with routing and auth, ready for you to build out into a real app.

#### Changing the code

Let's change the code and see what happens. Open a project page in your browser and add a few todos. Note that new todo items are sorted last, at the bottom of the list.

Open up the code for the project page in `src/routes/_authenticated/project/$projectId.tsx`. You can see the live query for the todo list towards the top of the `ProjectPage` component:

```tsx
const { data: todos } = useLiveQuery(
  (q) =>
    q
      .from({ todoCollection })
      .where(({ todoCollection }) =>
        eq(todoCollection.project_id, projectId, 10)
      )
      .orderBy(({ todoCollection }) => todoCollection.created_at),
  [projectId]
)
```

This queries the local TanStack DB `todoCollection` for todos that belong to the current project and sorts them by `created_at`. The default sort order is `asc`. Let's update the code to make that explicit.

```tsx
const direction = 'asc'

const { data: todos } = useLiveQuery(
  (q) =>
    q
      .from({ todoCollection })
      .where(({ todoCollection }) =>
        eq(todoCollection.project_id, parseInt(projectId, 10))
      )
      .orderBy(({ todoCollection }) => todoCollection.created_at, direction),
  [projectId, direction]
)
```

Now, with the browser page open and visible, toggle the direction value between `asc` and `desc`:

```tsx
const direction = 'desc'
```

You'll see the todo list re-ordering live in the page.

See the blog post introducing [developing with Electric and TanStack DB](/blog/2025/07/29/local-first-sync-with-tanstack-db) and the [Interactive Guide to TanStack DB](https://frontendatscale.com/blog/tanstack-db/) for a high level intro on the stack.

Dive into the [Tutorial](tutorial.md) for a more in-depth walkthrough of how to develop out a production-quality app with Electric and TanStack DB.

#### Using coding agents

The quickstart template ships with an `AGENTS.md` file. Load this into your LLM and have it make changes for you.

For example:

```
Read AGENTS.md. Sort the todo list on the project page alphabetically.
```

### Claim the resources

The Postgres database and Electric sync service provisioned when you generated the app are temporary. They'll be scaled down automatically and then deleted in a few days time.

To continue using them, you can claim them. This allows you to create or sign-in to accounts with Electric Cloud (for the sync service) and Neon (for the database hosting) and move the resources into your accounts so you can manage and control them.

To claim the resources run:

```shell
pnpm claim
```

Follow the instructions in the your web browser.

### Deploy and share the app

To deploy your local app to [Netlify](https://tanstack.com/start/latest/docs/framework/react/hosting#what-is-netlify), run:

```sh
pnpm deploy
```

TanStack Start is designed to work with any hosting provider. See the [Hosting docs](https://tanstack.com/start/latest/docs/framework/react/hosting) for instructions.







so if you already have a hosting provider in mind, you can deploy your application there using the full-stack APIs provided by TanStack Start.



TanStack Start is a full-stack framework powered by TanStack Router. It provides a full-document SSR, streaming, server functions, bundling, and more. Thanks to Vite, it's ready to develop and deploy to any hosting provider or runtime you want!

- [ ] deploy the app

== Docker Compose

... local docker content ...

== Manual install

... manual install flow ...

:::
