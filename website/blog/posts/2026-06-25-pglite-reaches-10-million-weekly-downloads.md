---
title: 'PGlite reaches 10 million weekly downloads'
description: >-
  PGlite has reached 10 million weekly npm downloads. This post looks back at
  how Postgres in WASM became a widely adopted embedded Postgres project, and
  where PGlite is going next.
excerpt: >-
  PGlite has reached 10 million weekly npm downloads. Here's how a small
  Postgres-in-WASM experiment became a widely used embedded Postgres project,
  and where it goes next.
authors: [samwillis, tdrz]
image: /img/blog/pglite-reaches-10-million-weekly-downloads/header.jpg
tags: [PGlite, Postgres]
outline: [2, 3]
post: true
published: true
---

<script setup>
import { ref } from 'vue'
import { defineClientComponent } from 'vitepress'
import Tweet from 'vue-tweet'

const pgliteReplLoading = ref(true)
const PGliteReplDemo = defineClientComponent(
  () => import('../../src/components/sync-home/PGliteReplDemo.vue'),
  undefined,
  () => {
    pgliteReplLoading.value = false
  }
)
</script>

<style scoped>
.pglite-repl-figure {
  background: none;
  margin: 32px 0;
}

.pglite-repl-panel {
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-code-block-bg, #161618);
}

.pglite-repl-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--vp-c-divider);
  color: rgba(255, 255, 255, 0.72);
  font-size: 12px;
}

.pglite-repl-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--vp-c-brand-1);
  box-shadow: 0 0 14px rgba(81, 214, 202, 0.55);
}

.pglite-repl-title {
  font-weight: 600;
}

.pglite-repl-meta {
  margin-left: auto;
  color: rgba(255, 255, 255, 0.5);
}

.pglite-repl-body {
  position: relative;
  min-height: 360px;
}

.pglite-repl-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.55);
  font-size: 13px;
  background: var(--vp-code-block-bg, #161618);
}

.logo-strip {
  margin: 28px 0 8px;
}
.logo-strip-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-around;
  gap: 22px 32px;
  padding: 26px 28px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-elv);
}
.logo-strip-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  justify-items: center;
}
.logo-strip-item {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  height: 46px;
  text-decoration: none;
  color: var(--vp-c-text-1);
  opacity: 0.9;
  transition: opacity 0.15s ease;
}
.logo-strip-item:hover {
  opacity: 1;
}
.logo-strip-item img {
  height: 32px;
  width: auto;
  max-width: 150px;
  object-fit: contain;
  display: block;
}
.logo-strip-item img.logo-icon {
  height: 28px;
  max-width: 32px;
}
.logo-strip-item img.logo-compact {
  height: 28px;
  max-width: 82px;
}
.logo-strip-item img.logo-wide {
  height: 28px;
  max-width: 150px;
}
.logo-strip-item img.logo-tall-wordmark {
  height: 44px;
  max-width: 130px;
}
.logo-strip-item img.logo-firebase {
  height: 58px;
  max-width: 174px;
}
.logo-strip-item img.logo-netlify {
  height: 52px;
  max-width: 156px;
}
.logo-strip-item img.logo-aws {
  height: 42px;
  max-width: 123px;
}
.logo-strip-item img.logo-supabase {
  height: 60px;
  max-width: 180px;
}
.logo-strip-label {
  color: var(--vp-c-text-1);
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
  line-height: 1;
  white-space: nowrap;
}
@media (max-width: 559px) {
  .logo-strip-row {
    gap: 18px 22px;
    padding: 20px;
  }
  .logo-strip-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .logo-strip-item {
    height: 34px;
  }
  .logo-strip-item img {
    height: 28px;
    max-width: 130px;
  }
  .logo-strip-item img.logo-icon {
    height: 24px;
    max-width: 28px;
  }
  .logo-strip-item img.logo-compact {
    height: 26px;
    max-width: 72px;
  }
  .logo-strip-item img.logo-wide {
    height: 26px;
    max-width: 140px;
  }
  .logo-strip-item img.logo-tall-wordmark {
    height: 34px;
    max-width: 110px;
  }
  .logo-strip-item img.logo-firebase {
    height: 44px;
    max-width: 132px;
  }
  .logo-strip-item img.logo-netlify {
    height: 40px;
    max-width: 120px;
  }
  .logo-strip-item img.logo-aws {
    height: 34px;
    max-width: 100px;
  }
  .logo-strip-item img.logo-supabase {
    height: 46px;
    max-width: 138px;
  }
  .logo-strip-label {
    font-size: 14px;
  }
}
</style>

PGlite has reached [10&nbsp;million weekly npm downloads](https://www.npmjs.com/package/@electric-sql/pglite). We want to mark the milestone by sharing what people are building with PGlite, how a small Postgres-in-WASM experiment got here, and where we want to take it next.

<figure>
  <div class="img-row">
    <div class="img-border">
      <a href="/img/blog/pglite-reaches-10-million-weekly-downloads/npm-downloads.png">
        <img src="/img/blog/pglite-reaches-10-million-weekly-downloads/npm-downloads.png"
            alt="npm weekly downloads graph for pglite.dev showing 10,048,112 weekly downloads"
        />
      </a>
    </div>
  </div>
</figure>

PGlite passed 1&nbsp;million weekly downloads just over a year ago. We always saw PGlite as something with reach beyond "embedded in your application" — but watching the community embrace it across local emulators, ORM integrations, test suites, browser sandboxes, AI apps, and the toolchains shipped by Prisma, Firebase, Netlify, and AWS has been the best part of getting here.

> [!WARNING] 🪧&nbsp; Quicklinks
> [PGlite](https://pglite.dev/) is Postgres compiled to WASM, packaged for JavaScript environments including browsers, Node.js, Bun, and Deno.
>
> - [PGlite docs](https://pglite.dev/)
> - [PGlite REPL](https://pglite.dev/repl/)
> - [GitHub](https://github.com/electric-sql/pglite/)
> - [Discord](https://discord.gg/pVASdMED)

## What's driving the downloads

### Local development without Docker

The biggest single category is local development for managed Postgres products. PGlite lets a CLI hand a developer a database the moment they install, then transparently swap in a cloud Postgres later without changing the application's connection code.

[Prisma](https://www.prisma.io/docs/postgres/database/local-development) bundles PGlite as the local engine for Prisma Postgres. Firebase runs it under [SQL Data Connect](https://firebase.google.com/docs/data-connect) for local prototyping. Netlify uses it to give developers an instant database when they spin up [Netlify Database](https://docs.netlify.com/build/data-and-storage/netlify-database/local-development/). And [AWS Blocks](https://docs.aws.amazon.com/blocks/latest/devguide/bb-data-storage.html) ships PGlite as the local implementation of `Database` and `DistributedDatabase`, mapping those same APIs to Aurora Serverless v2 and Aurora DSQL when the app deploys.

<figure class="logo-strip">
  <div class="logo-strip-row">
    <a class="logo-strip-item" href="https://www.prisma.io/docs/postgres/database/local-development">
      <img class="logo-wide" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/wordmark/prisma-dark.svg" alt="Prisma" />
    </a>
    <a class="logo-strip-item" href="https://firebase.google.com/docs/data-connect">
      <img class="logo-firebase" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/wordmark/firebase-dark.svg" alt="Firebase" />
    </a>
    <a class="logo-strip-item" href="https://docs.netlify.com/build/data-and-storage/netlify-database/local-development/">
      <img class="logo-netlify" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/wordmark/netlify-dark.svg" alt="Netlify" />
    </a>
    <a class="logo-strip-item" href="https://docs.aws.amazon.com/blocks/latest/devguide/bb-data-storage.html">
      <img class="logo-aws" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/aws.svg" alt="AWS" />
    </a>
  </div>
</figure>

These are very different products solving the same problem: how to give a developer a database the second they install, behaving close enough to the managed Postgres they'll eventually ship to.

### Local AI and search

AI apps need somewhere to keep embeddings, metadata, conversation history and document chunks, and somewhere to run full-text search and joins over all of it. PGlite gives them a local Postgres for the whole stack, `pgvector` included.

A particularly clear recent example is [GBrain](https://github.com/garrytan/gbrain), the personal-AI brain that Garry Tan (President of Y Combinator) built to run his own agents. GBrain [recently made PGlite its default engine](https://x.com/garrytan/status/2042920191303258192) for personal brains — "database ready in 2 seconds, no server" — using hybrid HNSW + BM25 retrieval over `pgvector` to run brains of up to ~50K pages on a developer's own machine.

<figure>
  <div class="img-row">
    <div class="img-border">
      <a href="https://x.com/garrytan/status/2042920191303258192">
        <img src="/img/blog/pglite-reaches-10-million-weekly-downloads/garry-tan-gbrain-tweet.png"
            alt="Garry Tan announcing PGlite as the default engine for GBrain on X: 'PGLite (embeddable WASM Postgres with vector support) is the default engine now, so no fumbling with API keys to get it going.'"
        />
      </a>
    </div>
  </div>
</figure>

It also shows up in [Hugging Face's Transformers.js](https://huggingface.co/docs/transformers.js) semantic search demos, in [Obsidian Smart Composer](https://github.com/glowingjade/obsidian-smart-composer) and [Infio Copilot](https://github.com/infiolab/infio-copilot), in [ElizaOS](https://github.com/elizaOS/eliza), in a number of agent-memory packages, and in experiments like local semantic search over your starred GitHub repos.

Inference, embeddings and vector search can all sit next to the application — in the browser or in the app — instead of being a separate service a round trip away.

### Tests with real Postgres semantics

Test suites want databases that come up fast, stay isolated between tests, and don't leave anything behind when they finish. PGlite gives you that inside the test process — without dropping to a mock or a different SQL dialect.

[Drizzle](https://orm.drizzle.team) uses PGlite in its integration tests. [Supabase](https://supabase.com) pulls it into local mocks and test harnesses. [Prisma](https://www.prisma.io) provides tooling for running tests against PGlite, giving projects a fast, throwaway database that still talks the same SQL as production.

The useful part is that tests can exercise real Postgres behavior, not just adapter wiring. Drizzle's own [PGlite integration tests](https://github.com/drizzle-team/drizzle-orm/blob/48e54060/integration-tests/tests/pg/pglite.test.ts) spin up PGlite, reset the schema, then assert against real query results:

```ts
import { PGlite } from '@electric-sql/pglite'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/pglite'
import { beforeAll, beforeEach, expect, test } from 'vitest'

let db

beforeAll(() => {
  db = drizzle(new PGlite())
})

beforeEach(async () => {
  await db.execute(sql`drop schema if exists public cascade`)
  await db.execute(sql`create schema public`)
  await db.execute(sql`
    create table users (
      id serial primary key,
      name text not null
    )
  `)
})

test('insert via db.execute + select via db.execute', async () => {
  await db.execute(sql`insert into users (name) values (${'John'})`)

  const result = await db.execute(sql`select id, name from users`)
  expect(Array.from(result.rows)).toEqual([{ id: 1, name: 'John' }])
})
```

<figure class="logo-strip">
  <div class="logo-strip-row">
    <a class="logo-strip-item" href="https://orm.drizzle.team">
      <img class="logo-wide" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/wordmark/drizzle-dark.svg" alt="Drizzle" />
    </a>
    <a class="logo-strip-item" href="https://supabase.com">
      <img class="logo-supabase" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/wordmark/supabase-dark.svg" alt="Supabase" />
    </a>
    <a class="logo-strip-item" href="https://www.prisma.io">
      <img class="logo-wide" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/wordmark/prisma-dark.svg" alt="Prisma" />
    </a>
  </div>
</figure>

Tests run fast enough for CI and behave close enough to production that the bugs surface in tests, not later.

### ORMs and frameworks

A lot of adoption depends on the Postgres ecosystem around PGlite, not just PGlite itself. Once Drizzle or Kysely treats it as a normal Postgres target, the rest of the project does too.

PGlite now shows up across the Postgres tooling layer: Drizzle, [Kysely](https://kysely.dev), Prisma, [MikroORM](https://mikro-orm.io), [Effect SQL](https://effect.website/docs/sql/introduction), [Knex](https://knexjs.org), [TypeORM](https://typeorm.io), [Orange ORM](https://orange-orm.io) and others all [document how to point at it](https://pglite.dev/docs/orm-support).

<figure class="logo-strip">
  <div class="logo-strip-row logo-strip-grid">
    <a class="logo-strip-item" href="https://orm.drizzle.team">
      <img class="logo-wide" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/wordmark/drizzle-dark.svg" alt="Drizzle" />
    </a>
    <a class="logo-strip-item" href="https://kysely.dev">
      <img class="logo-icon" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/kysely.svg" alt="" />
      <span class="logo-strip-label">Kysely</span>
    </a>
    <a class="logo-strip-item" href="https://www.prisma.io">
      <img class="logo-wide" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/wordmark/prisma-dark.svg" alt="Prisma" />
    </a>
    <a class="logo-strip-item" href="https://mikro-orm.io">
      <img class="logo-icon" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/mikroorm.svg" alt="" />
      <span class="logo-strip-label">MikroORM</span>
    </a>
    <a class="logo-strip-item" href="https://effect.website/docs/sql/introduction">
      <img src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/wordmark/effect-dark.svg" alt="Effect" />
    </a>
    <a class="logo-strip-item" href="https://knexjs.org">
      <img class="logo-icon" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/knex.svg" alt="" />
      <span class="logo-strip-label">Knex.js</span>
    </a>
    <a class="logo-strip-item" href="https://typeorm.io">
      <img class="logo-wide" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/wordmark/typeorm-dark.png" alt="TypeORM" />
    </a>
    <a class="logo-strip-item" href="https://orange-orm.io">
      <img class="logo-icon" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/orangeorm.svg" alt="" />
      <span class="logo-strip-label">Orange ORM</span>
    </a>
  </div>
</figure>

Embedded Postgres is much more useful when developers don't have to throw away their existing migrations, schemas, query builders and type-safe database code to use it.

### Browser sandboxes and interactive docs

PGlite also runs Postgres in places a database server couldn't — inside browser products, docs, demos, and even research papers.

Supabase built [`database.build`](https://database.build/) on top of PGlite: an AI-assisted database design tool that runs entirely in the browser. [Supabase Studio](https://supabase.com/dashboard) uses it as a sandbox for testing RLS policies without touching the real database. The [Key Joins proposal](https://keyjoin.org/) goes further and embeds a custom PGlite build into the paper itself, so readers can run the proposed SQL syntax inline as they read.

Smaller tools wrap PGlite for interactive code playgrounds: [LiveCodes](https://livecodes.io/) and [Codapi](https://codapi.org/) both let authors embed runnable Postgres snippets directly in their docs.

<figure class="logo-strip">
  <div class="logo-strip-row">
    <a class="logo-strip-item" href="https://livecodes.io/">
      <img class="logo-icon" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/livecodes.svg" alt="" />
      <span class="logo-strip-label">LiveCodes</span>
    </a>
    <a class="logo-strip-item" href="https://codapi.org/">
      <img class="logo-icon" src="/img/blog/pglite-reaches-10-million-weekly-downloads/logos/codapi.svg" alt="" />
      <span class="logo-strip-label">Codapi</span>
    </a>
  </div>
</figure>

The video below shows the kind of browser-native database workflow that PGlite makes possible in [`database.build`](https://database.build/): the database is created, queried and iterated on inside the page, with no server to provision first.

<figure>
  <div class="embed-container" style="padding-bottom: 56.25%">
    <YoutubeEmbed video-id="ooWaPVvljlU" title="I gave AI full control over my database (postgres.new)" />
  </div>
</figure>

None of these could work with a Postgres server. With PGlite the database is part of the document or the application, not something you point at over a network.

## Postgres is showing up in smaller places

All these different settings share one underlying need: a database that runs close to the application. Local emulators, test suites, browser sandboxes, AI runtimes — they all want Postgres behaviour without having to run a Postgres server.

It helps when development, testing, local state and production all use the same database. Fewer translations between environments, fewer bugs that only show up in one of them.

AI coding agents writing code inside sandboxes make this trade-off sharper. The sandbox needs to look enough like production that the agent's work is meaningful, but it also has to stay cheap, fast and throwaway. A full Postgres server is too much; a different local database is too different.

[PGlite](/sync/pglite) is the in-between: Postgres semantics in places that need something smaller than a database server, including the things people reach for as projects grow — types, indexes, constraints, full-text search, `pgvector`, PostGIS and other extensions.

## How PGlite got here

In January 2024, Jarred Sumner asked publicly when "PostgresLite" would become a thing.

<figure style="background: none">
  <div style="max-width: 550px; margin: 0 auto">
    <Tweet tweet-id="1751967157884432652" conversation="none" theme="dark" width="550" />
  </div>
</figure>

The tweet made the idea feel timely, and got us looking again at a proof of concept Stas Kelvich at Neon had shared with us a while earlier: [Postgres running in WASM](https://github.com/kelvich/postgres_wasm).

At Electric we'd been bumping into a related problem from a different direction. We were syncing Postgres on the server into local databases on the client, and the hard part was always fidelity. Postgres has so many types, semantics and extensions that translating it into a different local database leaks behaviour somewhere every time.

The breakthrough Stas had already made was running Postgres in single-user mode inside WASM. Postgres normally lives as a multi-process system — a postmaster accepts connections and forks backend processes to handle them — which doesn't map onto WASM at all. Single-user mode collapses that into one process and one connection, just enough that you can package the result and ship it as a library.

We picked that up in February 2024 and had something working by the end of the month. The first cut was basic: single-user mode, JSON output hacked in, persistence either in memory or against a virtual filesystem. Rough, but real — you could import PGlite and run actual Postgres queries inside Node.js, Bun or the browser. The ["got it working" announcement](https://x.com/ElectricSQL/status/1760734511132995604) went out shortly after.

## Making it feel like Postgres

The early version could run queries, but using it from JavaScript still didn't feel much like working with Postgres.

Implementing the wire protocol changed that. Parameterised queries, type metadata, the connection lifecycle people expect from Postgres clients — all of it became possible once PGlite spoke the same protocol as every other Postgres client. Pulling `Asyncify` out of the main loop on the way made queries much faster on top.

Beyond querying, `pg_notify` unlocked local live queries: SQL queries that re-run reactively when their underlying tables change. Extension support pulled PGlite closer to being Postgres rather than just SQL-in-WASM — first with contrib extensions and `pgvector`, then PostGIS and a growing set of community-built extensions.

### Extensions make it Postgres

[PostGIS](/blog/2026/03/25/announcing-pglite-v04) was one of the most requested extensions. You can install it as a PGlite extension package:

```bash
npm install @electric-sql/pglite-postgis
```

```typescript
import { PGlite } from '@electric-sql/pglite'
import { postgis } from '@electric-sql/pglite-postgis'

const pg = new PGlite({
  extensions: {
    postgis,
  },
})

await pg.exec('CREATE EXTENSION IF NOT EXISTS postgis;')
```

Community contributors have brought extensions like Apache AGE, `pg_uuidv7`, `pgTAP`, `pg_hashids`, `pgcrypto` and PostGIS to PGlite.

That brings the Postgres extension model into embedded environments, so the parts of Postgres people reach for in production are reachable locally too.

### Postgres in the browser

Running Postgres in the browser also changes what docs and demos can do. Instead of telling readers to install a database, you can drop a live one in front of them. The REPL below is running PGlite inside this page:

<figure class="pglite-repl-figure">
  <div class="pglite-repl-panel">
    <div class="pglite-repl-header mono">
      <span class="pglite-repl-dot" />
      <span class="pglite-repl-title">PGlite&nbsp;REPL</span>
      <span class="pglite-repl-meta">WASM Postgres · in this page</span>
    </div>
    <div class="pglite-repl-body">
      <div v-if="pgliteReplLoading" class="pglite-repl-loading mono">
        Booting PGlite&hellip;
      </div>
      <PGliteReplDemo />
    </div>
  </div>
</figure>

## What the pattern means

No single killer app got PGlite to 10M downloads. It's been a steady accumulation of teams from very different starting points all reaching for Postgres they can run wherever the application is — inside a CLI, inside a test, inside the browser tab, inside an AI agent — without giving up the behaviour they'd get from the managed Postgres they'll eventually deploy against.

Electric's own [PGlite sync adapter](/sync/pglite) is in that picture too: remote Postgres data syncs into a local PGlite that still behaves like Postgres, instead of being translated into a different local data model on the way down.

## Where PGlite goes next

We want PGlite to feel less like "Postgres squeezed into WASM" and more like embedded Postgres.

Recent architecture work has cut down the amount of custom Postgres code PGlite carries. That makes upstream upgrades less painful, gives contributors a more approachable codebase to land in, and makes PGlite a more realistic candidate for porting to other targets.

More extensions. The thing that makes Postgres what it is, more than anything else, is its extension ecosystem — and the more of it runs in PGlite, the more useful PGlite gets.

Multi-connection support is the next piece. PGlite still works around Postgres single-user mode under the hood; getting past that — through multi-instance or multi-threaded approaches — would let multiple connections work against the same database the way they do in a normal Postgres deployment. Logical replication is on the same list. Replicating in and out of PGlite would let it sit inside a Postgres topology rather than next to one.

The longer-term ambition is `libpglite`: a native, embeddable Postgres library for mobile, desktop and other non-JavaScript environments. The aim is for Postgres to be embeddable as broadly as SQLite, with the full Postgres feature set and tooling along for the ride.

## Try it, build with it, tell us what you make

Install PGlite:

```bash
npm install @electric-sql/pglite
```

Create a database and run a query:

```typescript
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
await db.exec('CREATE TABLE test (id serial PRIMARY KEY, name text)')
await db.exec("INSERT INTO test (name) VALUES ('hello')")
const result = await db.query('SELECT * FROM test')
```

Or run it behind a Postgres socket for tools that expect a normal database connection:

```bash
npm install @electric-sql/pglite @electric-sql/pglite-socket
```

```typescript
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

const db = await PGlite.create()
const server = new PGLiteSocketServer({
  db,
  host: '127.0.0.1',
  port: 5432,
})

await server.start()
```

The [`pglite-socket`](https://pglite.dev/docs/pglite-socket) package also ships a `pglite-server` CLI that can start your app with `DATABASE_URL` already pointing at PGlite.

You can find the project on [GitHub](https://github.com/electric-sql/pglite/) and join the [Discord](https://discord.gg/pVASdMED).

Most of all, tell us what you're building — or want to build — with embedded Postgres. Thanks to everyone who's helped get PGlite here: users, contributors, extension authors, maintainers, and the teams who bet on it early.
