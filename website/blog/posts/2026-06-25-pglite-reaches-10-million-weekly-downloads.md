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

[Prisma](https://www.prisma.io/docs/postgres/database/local-development) bundles PGlite as the local engine for Prisma Postgres. Firebase runs it under SQL Data Connect for local prototyping. Netlify uses it to give developers an instant database when they spin up Netlify Database. And [AWS Blocks](https://docs.aws.amazon.com/blocks/latest/devguide/bb-data-storage.html) ships PGlite as the local implementation of `Database` and `DistributedDatabase`, mapping those same APIs to Aurora Serverless v2 and Aurora DSQL when the app deploys.

<!-- TODO: add logo row for Prisma, Firebase, Netlify, AWS Blocks, NuxtHub, and Backstage. -->

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

It also shows up in Hugging Face's Transformers.js semantic search demos, in Obsidian Smart Composer and Infio Copilot, in ElizaOS, in a number of agent-memory packages, and in experiments like local semantic search over your starred GitHub repos.

Inference, embeddings and vector search can all sit next to the application — in the browser or in the app — instead of being a separate service a round trip away.

### Tests with real Postgres semantics

Test suites want databases that come up fast, stay isolated between tests, and don't leave anything behind when they finish. PGlite gives you that inside the test process — without dropping to a mock or a different SQL dialect.

Drizzle uses PGlite in its integration tests. Supabase pulls it into local mocks and test harnesses. The Prisma + Vitest community has converged on it as the default way to get a fast, throwaway database that still talks the same SQL as production.

<!-- TODO: add one stronger anchor example here, ideally a screenshot or short code excerpt from Drizzle, Supabase, or Prisma/Vitest. -->

Tests run fast enough for CI and behave close enough to production that the bugs surface in tests, not later.

### ORMs and frameworks

A lot of adoption depends on the Postgres ecosystem around PGlite, not just PGlite itself. Once Drizzle or Kysely treats it as a normal Postgres target, the rest of the project does too.

PGlite now shows up across the Postgres tooling layer: Drizzle, Kysely, Prisma, MikroORM, Effect SQL, Knex, TypeORM, Orange ORM and others all document how to point at it.

<!-- TODO: add a compact logo grid for ORMs and frameworks. -->

Embedded Postgres is much more useful when developers don't have to throw away their existing migrations, schemas, query builders and type-safe database code to use it.

### Browser sandboxes and interactive docs

PGlite also runs Postgres in places a database server couldn't — inside browser products, docs, demos, and even research papers.

Supabase built [`database.build`](https://database.build/) on top of PGlite: an AI-assisted database design tool that runs entirely in the browser. Supabase Studio uses it as a sandbox for testing RLS policies without touching the real database. The [Key Joins proposal](https://keyjoin.org/) goes further and embeds a custom PGlite build into the paper itself, so readers can run the proposed SQL syntax inline as they read.

<!-- TODO: add screenshots or short videos for `database.build`, Supabase Studio RLS Tester, and KeyJoin. Add a logo row or short mention for LiveCodes, Codapi, `pg-browser-proxy`, and `pglite-server`. -->

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

You can find the project on [GitHub](https://github.com/electric-sql/pglite/) and join the [Discord](https://discord.gg/pVASdMED).

Most of all, tell us what you're building — or want to build — with embedded Postgres. Thanks to everyone who's helped get PGlite here: users, contributors, extension authors, maintainers, and the teams who bet on it early.
