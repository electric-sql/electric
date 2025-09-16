---
title: Sync stacks
description: >-
  Electric provides composable sync primitives that allow you to add real-time sync to your existing stack, without imposing technology choices, code changes or data silos.
outline: [2,3]
image: /img/tutorials/sync-busters.jpg
---

<script setup>
  import Card from '../src/components/home/Card.vue'

  import ComponentsJPG from '/static/img/docs/guides/deployment/components.jpg?url'
  import ComponentsPNG from '/static/img/docs/guides/deployment/components.png?url'
  import ComponentsSmPNG from '/static/img/docs/guides/deployment/components.sm.png?url'
</script>

<style scoped>
  .stack-cards {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin: 24px 0 32px;
  }
  .stack-cards :deep(.card) {
    display: flex !important;
    flex-direction: row !important;
    align-items: flex-start !important;
    padding: 0 !important;
  }

  .stack-cards :deep(.card .icon) {
    flex-shrink: 0;
    padding-right: 3px !important;
    align-self: flex-start;
  }

  .stack-cards :deep(.card .icon img) {
    width: calc(33px + 1.5vw);
    height: calc(33px + 1.5vw);
    min-width: 40px;
    min-height: 40px;
  }

  .stack-cards :deep(.card .body) {
    flex: 1;
    /*padding: 0 0 0 8px !important;*/
  }

  .stack-cards :deep(.card .body h3) {
    margin: 0 0 0.5rem 0 !important;
  }

  .stack-cards :deep(.card .body p) {
    max-width: none !important;
    margin-bottom: 0.25rem;
  }

  @media (max-width: 559px) {
    .stack-cards :deep(.card .body h3) {
      margin-top: 0.25rem !important;
    }

    .stack-cards :deep(.card .body p) {
      margin-bottom: 0.5rem;
    }
  }

  .heading-icon {
    width: 72px;
    margin: 5px 0 9px;
  }

  ul.stack {
    list-style: none;
    margin: 14px 0;
    padding: 0;
    display: flex;
  }
  ul.stack li {
    display: flex;
    align-items: center;
    height: 30px;
    margin: 0px !important;
  }
  ul.stack img {
    width: 21px;
    margin: 3.5px 5px 3.5px 0;
    height: 21px;
  }
  ul.stack span.name {
    margin-right: 1rem;
    height: 30px;
    line-height: 30px;
    color: var(--vp-c-text-3);
    font-size: 14px;
    font-weight: 400;
  }
  @media (max-width: 518px) {
    .avatar img {
      margin-top: 12px;
      width: 128px;
    }
  }
  @media (max-width: 689px) {
    ul.stack li:first-child {
      display: none;
    }
  }
  @media (max-width: 599px) {
    ul.stack img {
      width: 18px;
      margin: 2.5px 3px 2.5px 0;
      height: 18px;
    }
    ul.stack span.name {
      font-size: 13px;
    }
  }
  @media (max-width: 599px) {
    ul.stack li:first-child {
      display: flex;
    }
    ul.stack img {
      margin-right: 9px;
    }
    ul.stack span.name {
      display: none;
    }
  }
</style>

<img src="/img/icons/stack.svg" class="product-icon"
    style="width: 72px"
/>

# Sync with your stack

Electric provides [composable](/#works-with-section) sync primitives.

This allows you to add real-time sync to [your existing stack](/blog/2024/11/21/local-first-with-your-existing-api), without imposing technology choices, code changes or data silos.

## Sync stacks

We've picked four different sync stacks to illustrate four different ways of integrating Electric into your stack of choice.

<div class="stack-cards">

<Card title="TanStack" icon="/img/integrations/tanstack.svg" href="#tanstack">
  <p>
    End-to-end Typescript, syncing through server functions into TanStack DB.
    <span class="hidden-sm"><span class="no-wrap-sm">Great for super fast</span> web, mobile and AI app development.</span>
  </p>
  <p class="hidden-xs block-sm">
    Great for super fast web, mobile and
    <span class="no-wrap">AI app development</span>.
  </p>
  <ul class="stack">
    <li v-for="item in ['Postgres', 'Electric', 'TypeScript', 'Cloudflare', 'TanStack']" :key="item">
      <img :src="`/img/integrations/${item.toLowerCase()}.svg`" />
      <span class="name">{{ item }}</span>
    </li>
  </ul>
</Card>

<Card title="Phoenix" icon="/img/integrations/phoenix.svg" href="#phoenix">
  <p>
    Sync through a batteries-included backend framework using Phoenix.Sync.
    <span class="hidden-sm">Great for <span class="no-wrap-sm">agentic systems</span> and full-stack development.</span>
  </p>
  <p class="hidden-xs block-sm">
    Great for agentic systems and
    <span class="no-wrap">full-stack development</span>.
  </p>
  <ul class="stack">
    <li v-for="item in ['Postgres', 'Electric', 'Phoenix', 'TanStack']" :key="item">
      <img :src="`/img/integrations/${item.toLowerCase()}.svg`" />
      <span class="name">{{ item }}</span>
    </li>
  </ul>
</Card>

<Card title="PGlite" icon="/img/integrations/pglite.svg" href="#pglite">
  <p>
    Syncing data into an embedded Postgres database using PGlite.
    <span class="hidden-sm"><span class="no-wrap-sm">Great for dev,</span> test and sandbox environments.</span>
  </p>
  <p class="hidden-xs block-sm">
    Great for dev, test and sandbox environments.
  </p>
  <ul class="stack">
    <li v-for="item in ['Postgres', 'Electric', 'PGlite']" :key="item">
      <img :src="`/img/integrations/${item.toLowerCase()}.svg`" />
      <span class="name">{{ item }}</span>
    </li>
  </ul>
</Card>

<Card title="Yjs" icon="/img/integrations/yjs.svg" href="#yjs">
  <p>
    Crafting conflict-free, multi-user applications with Electric and Yjs.
    <span class="hidden-sm"><span class="no-wrap-sm">Great for fine-tuned</span> realtime collaboration.</span>
  </p>
  <p class="hidden-xs block-sm">
    Great for fine-tuned realtime collaboration.
  </p>
  <ul class="stack">
    <li v-for="item in ['Postgres', 'Electric', 'Yjs']" :key="item">
      <img :src="`/img/integrations/${item.toLowerCase()}.svg`" />
      <span class="name">{{ item }}</span>
    </li>
  </ul>
</Card>

</div>

### Core architecture

All of these sync stacks are based on the same core architecture.

[Electric](/docs/guides/deployment#_2-running-electric) always runs as a service in front of [Postgres](/docs/guides/deployment#_1-running-postgres), syncing into a [Client](/docs/guides/shapes#subscribing-to-shapes) process or store, via a [Proxy](/docs/guides/auth#requests-can-be-proxied) or backend API.

<figure>
  <a :href="ComponentsJPG">
    <img :src="ComponentsPNG" class="hidden-sm"
        alt="Illustration of the main components of a successfull deployment"
    />
    <img :src="ComponentsSmPNG" class="block-sm"
        style="max-width: 360px"
        alt="Illustration of the main components of a successfull deployment"
    />
  </a>
</figure>

You can learn more about these by following <!-- the Tutorial and -->[Deployment](/docs/guides/deployment) guide.

### Choosing a stack

We recommend using [TanStack DB](#tanstack-db) for web and mobile app development. It's super fast, lightweight, type-safe and gives you an [optimal, end-to-end, local-first sync stack](http://localhost:5173/blog/2025/07/29/local-first-sync-with-tanstack-db).

You can also combine TanStack DB with [Phoenix.Sync](#phoenix-sync) if you're building agentic systems with Elixir or looking for a batteries-included backend framework.

[PGlite](#pglite) and [Yjs](#yjs) are more for specialist use-cases where you're syncing into a dev, test or CI environment or crafting a multi-user collaboration system, respectively.

### Choosing a Postgres host

Electric works with [any Postgres with logical replication](/docs/guides/deployment#_1-running-postgres) enabled. [Neon](/docs/integrations/neon), [Supabase](/docs/integrations/supabase) and [Crunchy](/docs/integrations/crunchy) are all great choices for a Postgres host.

### Hosting your proxy

You can proxy requests to Electric either [through your backend API](http://localhost:5173/docs/guides/auth#it-s-all-http), or through a cloud worker. [Cloudflare](/docs/integrations/cloudflare) is a great choice for hosting workers because it only charges for actual processing time (not for wall clock time holding [sync connections](/docs/api/http#live-mode) open).

### Other stacks

The stacks on this page are just some options and recommendations. You can use Electric with any&nbsp;technology you like &mdash; as long as it speaks [HTTP&nbsp;and&nbsp;JSON](/docs/guides/client-development).

For example, sync into [LiveStore](https://docs.livestore.dev/reference/syncing/sync-provider/electricsql/) for a principled, event-sourcing based development model. Or [distributed SQlite](https://github.com/electric-sql/postgres-to-sqlite-sync-example) or [native iOS apps](https://github.com/paulharter/ElectricSync).

## <img class="heading-icon" src="/img/integrations/tanstack.svg" /> TanStack

<blockquote class="block-xs">
  Great for super fast web, mobile and AI app development.
</blockquote>

| Database | Backend             | Schema  | Proxy      | Client           | Writes |
| -------- | ------------------- | ------- | ---------- | ---------------- | ------ |
| Postgres | TanStack&nbsp;Start | Drizzle | Cloudflare | TanStack&nbsp;DB | tRPC   |

[Tanstack DB](https://tanstack.com/db) is a reactive client store for [building super fast apps on&nbsp;sync](https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query).

[Paired with Electric](/blog/2025/07/29/local-first-sync-with-tanstack-db) and [TanStack Start](https://tanstack.com/start), it gives you an end-to-end sync stack that's type-safe, declarative, incrementally adoptable and insanely fast.

### End-to-end Typescript

See the [tanstack-db-web-starter](https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-web-starter) for an example of an end-to-end Typescript stack for web app development:

- based on Postgres, using [Drizzle](https://orm.drizzle.team/) for data schemas and migrations
- syncing data out of Electric through [TanStack Start server functions](https://tanstack.com/start/latest/docs/framework/react/server-functions)
- into [TanStack DB collections](https://tanstack.com/db/latest/docs/overview#defining-collections) for reactive, local-first client-side development
- using [tRPC mutation proceedures](https://trpc.io/docs/server/procedures) for type-safe write handling on the server

See also the [tanstack-db-expo-starter](https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-expo-starter) for a similar stack for mobile app development.

### Incremental adoption

TanStack DB is designed to be incrementally adoptable into existing applications.

It's tiny &mdash; a few Kbs &mdash; so doesn't introduce a big dependency. It works with all major front-end reactivity frameworks. It works with API-based data loading and sync. So you can progressively adopt by first migrating API-based apps using TanStack Query and then migrate to sync without affecting the component code.

### Super fast 🔥

When you combine Electric with TanStack DB, you get blazing fast <span class="no-wrap-sm">end-to-end reactivity</span>.

Components use [live queries](https://tanstack.com/db/latest/docs/guides/live-queries) to react and when data changes. These are based on a [Typescript implementation of differential dataflow](https://github.com/electric-sql/d2ts). This means you can build complex client apps where everything reacts instantly, within a single animation frame.

#### More information

- [Local-first sync with TanStack DB and Electric](/blog/2025/07/29/local-first-sync-with-tanstack-db)
- [TanStack DB, the embedded client database for TanStack Query](https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query)
- [An interactive guide to TanStack DB](https://frontendatscale.com/blog/tanstack-db)

## <img class="heading-icon" src="/img/integrations/phoenix.svg" /> Phoenix

<blockquote class="block-xs">
  Great for agentic systems and full-stack development.
</blockquote>

| Database | Backend | Schema | Proxy   | Client           | Writes  |
| -------- | ------- | ------ | ------- | ---------------- | ------- |
| Postgres | Phoenix | Ecto   | Phoenix | TanStack&nbsp;DB | Phoenix |

[Phoenix](https://www.phoenixframework.org) is a full-stack web development framework for [Elixir](https://elixir-lang.org).

Electric is [developed in Elixir](/product/electric#how-does-it-work), has a first-class [Elixir client](/docs/api/clients/elixir) and a deep Phoenix framework integration in the form of the official [Phoenix.Sync](https://hexdocs.pm/phoenix_sync) library.

### Phoenix.Sync

Phoenix.Sync enables real-time sync for Postgres-backed [Phoenix](https://www.phoenixframework.org/) applications. You can use it to sync data into Elixir, `LiveView` and frontend web and mobile applications.

### Using with TanStack DB

Read-path sync works naturally with TanStack DB. Plus it provides:

- a [`Writer`](https://hexdocs.pm/phoenix_sync/readme.html#write-path-sync) module for ingesting TanStack DB mutations
- [`Igniter` and `Mix` commands](https://github.com/electric-sql/phoenix_sync/pull/102) to integrate TanStack DB with Phoenix

### Building agentic systems

Phoenix is built in [Elixir](https://elixir-lang.org), which runs on the [BEAM](https://blog.stenmans.org/theBeamBook/). The BEAM provides a robust agentic runtime environment with built-in primitives for [process supervision and messaging](https://hexdocs.pm/elixir/processes.html).

This makes Elixir and Phoenix a perfect match for agentic system development [without needing a seperate agent framework](https://goto-code.com/blog/elixir-otp-for-llms/).

#### More information

- [Burn](/demos/burn) agentic demo app
- [Bringing agents back down to earth](/blog/2025/08/12/bringing-agents-back-down-to-earth) blog post
- [Phoenix integration page](/docs/integrations/phoenix)
- [Phoenix.Sync documentation](https://hexdocs.pm/phoenix_sync)

## <img class="heading-icon" src="/img/integrations/pglite.svg" /> PGlite

<blockquote class="block-xs">
  Great for dev, test and sandbox environments.
</blockquote>

| Database | Client | Writes |
| -------- | ------ | ------ |
| Postgres | PGlite | Custom |

PGlite is an embeddable Postgres database.

Electric can sync data into PGlite to hydrate lightweight database instances for dev, test and sandboxed environments

### Lightweight developer database

Platforms including Google Firebase, Supabase and Prisma all use PGlite as a development database. It's proper Postgres that can run embedded, in-process. So you don't need any external processes or system packages to use it.

Having a Postgres database is as simple as:

```shell
npm install @electric-sql/pglite
```

```ts
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
````

### Database in the sandbox

AI app builders like Bolt, Lovable and Replit can generate database-driven apps and run them in a sandboxed dev environment. However, to actually work, these apps need to connect to a database.

PGlite is a Postgres database that runs inside your dev environment. With it, you can one-shot database-driven apps that run without leaving the sandbox.

### Hydrating PGlite

Electric can be used to hydrate data into a PGlite instance using the [sync plugin](https://pglite.dev/docs/sync):

```ts
import { electricSync } from '@electric-sql/pglite-sync'

const pg = await PGlite.create({
  extensions: {
    electric: electricSync(),
  },
})
```

This supports individual tables and transactionally [syncing multiple tables](https://pglite.dev/docs/sync#syncshapestotables-api).

#### More information

- [PGlite website](https://pglite.dev) and [docs](https://pglite.dev/docs)
- [LinearLite demo](/demos/linearlite) using PGlite with Electric
- [Database.build](https://database.build/) by Supabase (running on PGlite)
- [Vibe coding with a database in the sandbox](/blog/2025/06/05/database-in-the-sandbox)

## <img class="heading-icon" src="/img/integrations/yjs.svg" /> Yjs

<blockquote class="block-xs">
  Great for fine-tuned realtime collaboration.
</blockquote>

| Database | Client | Writes |
| -------- | ------ | ------ |
| Postgres | Yjs    | Yjs    |

[Yjs](https://docs.yjs.dev) is a library for building collaborative applications.

### Conflict-free updates

Electric can be used as a transport layer with Yjs to create collaborative, multi-user applications on top of Postgres.

### Multi-user collaboration

This works by exposing a [Shape](/docs/guides/shapes) to sync changes for a [Y.Doc](https://docs.yjs.dev/api/y.doc). The `y-electric` package then automatically shares updates across all connected clients.

#### More information

- [Integration docs](/docs/integrations/yjs)
- [Notes demo](/demos/notes)
- [`y-electric` package](https://github.com/electric-sql/electric/tree/main/packages/y-electric)
