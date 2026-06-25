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
authors: [tdrz, samwillis]
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

PGlite has reached [10&nbsp;million weekly npm downloads](https://www.npmjs.com/package/@electric-sql/pglite). We want to mark the milestone by looking back at how a small Postgres-in-WASM experiment became a widely used embedded Postgres project, and by sharing where we want to take it next.

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

The number matters because PGlite is showing up inside real developer workflows: local emulators, ORM integrations, test suites, browser sandboxes, AI apps, and tools from companies like Prisma, Firebase, Netlify, and AWS. The download graph is really a story about embedded Postgres becoming useful in more places.

> [!WARNING] 🪧&nbsp; Quicklinks
> [PGlite](https://pglite.dev/) is Postgres compiled to WASM, packaged for JavaScript environments including browsers, Node.js, Bun, and Deno.
>
> - [PGlite docs](https://pglite.dev/)
> - [PGlite REPL](https://pglite.dev/repl/)
> - [GitHub](https://github.com/electric-sql/pglite/)
> - [Discord](https://discord.gg/pVASdMED)

## Postgres is showing up in smaller places

Developers keep finding reasons to put Postgres in places where a database server is too small or too temporary:

- [AI sandboxes](/blog/2025/06/05/database-in-the-sandbox) need a database inside the runtime so generated apps can run and be tested immediately.
- CI pipelines need isolated databases that can be created, reset, and thrown away cheaply.
- Local-first apps need durable storage with real query semantics.
- Sync systems need a local target that behaves like the Postgres it is syncing from.

They are different situations, but they all run into the same problem: the database needs to be closer to where the application is running.

It helps when development, testing, local state, and production all use the same database model. There is less translation between environments, and fewer bugs where a query works in one place but fails in another.

This matters even more now that AI coding agents are changing code inside sandboxes. A useful sandbox needs to look enough like production that the agent is working against the real system. But it also needs to be cheap, fast, and disposable. A full database server is often too much; a different local database is often too different.

[PGlite](/sync/pglite) is an attempt to make that tradeoff less awkward: real Postgres semantics in places that need something smaller than a database server.

You should be able to use the same schema and run the same queries, including the parts of Postgres people often reach for later: types, indexes, constraints, full-text search, `pgvector`, PostGIS, and other extensions.

## How PGlite got here

In January 2024, Jarred Sumner asked publicly when "PostgresLite" would become a thing.

<figure style="background: none">
  <div style="max-width: 550px; margin: 0 auto">
    <Tweet tweet-id="1751967157884432652" conversation="none" theme="dark" width="550" />
  </div>
</figure>

The tweet made the idea feel timely, and prompted us to take a second look at a proof of concept Stas Kelvich at Neon had previously shared with us: [Postgres running in WASM](https://github.com/kelvich/postgres_wasm).

At Electric, we were already thinking about a related problem. We were syncing Postgres on the server into local databases on clients, and the hard part was fidelity. Postgres has rich types, strict semantics, extensions, and plenty of behavior that application code comes to rely on. Translating that into a different local database creates friction.

So we picked up the proof of concept in February 2024. By the end of the month, it built, ran from an npm package, and had its first ["got it working" announcement](https://x.com/ElectricSQL/status/1760734511132995604). The first version was basic: Postgres single-user mode, hacked JSON output, and in-memory or filesystem-backed persistence. It was still rough, but you could start to see how it might become useful.

The first job was getting from "Postgres can technically run in WASM" to "you can install this package and build something with it."

Stas had cracked the first problem by getting Postgres running in single-user mode inside WASM. That mattered because Postgres normally uses a multi-process architecture: a postmaster accepts connections and forks backend processes to handle them. WASM does not map cleanly to that model.

Single-user mode gave us a path through that. It runs Postgres as a single process, which made it possible to package a working database into a JavaScript environment. The first PGlite release used that path. It was rough, but it was real: import PGlite and run Postgres inside Node.js, Bun, or the browser.

## Making it feel like Postgres

The early version could run queries, but using it from JavaScript did not yet feel much like using a real Postgres server.

The wire protocol changed that. It brought parameterized queries, type metadata, protocol behavior, and the developer experience people expect from Postgres clients. Refactoring the main loop removed `Asyncify` from the hot path and made query execution much faster.

Other pieces made it useful beyond one-off queries. `pg_notify` unlocked local live queries: SQL queries that can re-run reactively when underlying tables change. Extension support brought PGlite closer to the real Postgres platform, starting with contrib extensions and `pgvector`, then expanding toward PostGIS and community-built extensions.

It also meant we could build an interactive REPL for Postgres in the browser. The REPL below is running PGlite in this page:

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

Later architecture work reduced the amount of custom Postgres code PGlite has to carry. That makes upstream Postgres upgrades easier, helps contributors understand the codebase, and sets the project up for future ports.

### Basic usage

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

## What's driving the downloads

PGlite started as an Electric experiment. It changed once people began pulling it into workflows we could not have planned alone.

PGlite passed 1&nbsp;million weekly downloads a little over a year ago. It has now reached [10&nbsp;million weekly npm downloads](https://www.npmjs.com/package/@electric-sql/pglite). The number is worth celebrating because embedded Postgres is no longer just an interesting demo. It is being distributed through real tools people use.

What matters most, though, is what people are building with it, and how those projects stretch what "local Postgres" can mean.

### Local dev without Docker

The biggest pattern is local development for managed Postgres-shaped products. PGlite lets tools give developers a database immediately, then connect the same API to cloud infrastructure later.

- TODO: Add logo row or screenshots for Prisma, Firebase, Netlify, and AWS Blocks.
- **Prisma local dev:** [Prisma](https://www.prisma.io/docs/postgres/database/local-development) bundles PGlite into local Prisma Postgres development flows, bringing it to a much wider developer audience.
- **Firebase Data Connect:** Firebase uses PGlite as the local SQL/Data Connect emulator engine for prototyping and CI.
- **Netlify Database:** Netlify uses PGlite for local database dev emulation, exposing a normal local Postgres-shaped connection without asking users to run Postgres.
- **AWS Blocks:** [AWS Blocks](https://docs.aws.amazon.com/blocks/latest/devguide/bb-data-storage.html) uses PGlite locally for `Database` and `DistributedDatabase`, then maps those APIs to Aurora Serverless v2 and Aurora DSQL on AWS.
- Long tail to fill in: NuxtHub local PostgreSQL, Backstage repo-tools SQL reports, and other framework CLIs.

### Tests with real Postgres semantics

CI pipelines need isolated databases that can be created, reset, and thrown away cheaply. PGlite makes that possible inside the test process, while still exercising Postgres semantics rather than a mock database.

- TODO: Add one stronger anchor example with a screenshot or code excerpt.
- Anchor candidates: Drizzle's PGlite integration tests, Supabase MCP server test mocks, Prisma/Vitest examples.
- Long tail to fill in: Bun test package dependency, MakerKit's Prisma/Vitest guide, and community test setups.
- Point to make: no Docker, no network service, no alternate SQL dialect.

### ORMs and frameworks

Adoption followed when people could use PGlite for real workflows. ORMs and query builders are a big part of that because they make PGlite feel like a normal Postgres target.

- Mention first-class or documented support for Drizzle, Kysely, Prisma, MikroORM, Effect SQL, Knex, TypeORM, and Orange ORM.
- TODO: Decide whether this should be a compact prose paragraph or a visual grid.
- Point to make: PGlite adoption accelerates when developers can keep their existing query builders, migrations, schemas, and type-safe database code.

### Browser sandboxes and interactive docs

PGlite also makes Postgres available in places where a database server could never fit: browser products, docs, demos, and research papers.

- **database.build:** Supabase used PGlite for [`database.build`](https://database.build/), an AI database design tool that runs locally in the browser.
- **Supabase Studio RLS Tester:** Supabase Studio uses PGlite as a browser-side sandbox for testing RLS policies without modifying the actual database.
- **KeyJoin:** The [Key Joins proposal](https://keyjoin.org/) embeds a modified PGlite build directly in the paper so readers can run the proposed SQL syntax interactively in their browser.
- Long tail to fill in: LiveCodes, Codapi, `pg-browser-proxy`, and `pglite-server`.
- TODO: Add screenshots or short videos for `database.build`, Supabase RLS Tester, and KeyJoin.

### Local AI and search

AI apps need embeddings, metadata, history, document chunks, full-text search, and relational joins. PGlite gives local-first AI apps a Postgres-shaped memory substrate, including `pgvector`.

- Anchor candidates: Hugging Face Transformers.js semantic search, Obsidian Smart Composer, Infio Copilot.
- Long tail to fill in: GitHub stars semantic search, ElizaOS, agent-memory packages.
- Point to make: model inference can run locally, embeddings can live locally, and vector search can happen in browser-local or app-local Postgres.
- TODO: Choose 1-2 examples to expand with screenshots.

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

Community contributors helped bring extensions such as Apache AGE, `pg_uuidv7`, `pgTAP`, `pg_hashids`, `pgcrypto`, and PostGIS to PGlite.

- TODO: Expand this to cover external extensions: `pgvector`, PostGIS, Apache AGE, `pgTAP`, `pg_textsearch`, `pg_ivm`, `pg_uuidv7`, and `pg_hashids`.
- Point to make: this is not just SQL in WASM; it is the Postgres extension model moving into embedded environments.

## What the pattern means

That growth came from several directions: developer CLIs, CI pipelines, browser apps, AI sandboxes, local-first apps, and sync use cases.

The pattern is not one killer app. It is a new deployment shape for Postgres: embedded, disposable, local, browser-capable, and still close enough to production to reduce glue.

Electric built a [sync adapter](/sync/pglite) so remote Postgres data can sync into local PGlite while preserving the Postgres data model. That is another version of the same idea: keep the data model close to Postgres, even when the database is running somewhere smaller.

The project became more interesting each time someone used it somewhere we had not expected.

## Where PGlite goes next

Next, we want PGlite to feel less like "Postgres squeezed into WASM" and more like embedded Postgres.

More extensions are a major part of that. Postgres is powerful because of its extension ecosystem, and PGlite needs to make extension building and porting easier.

We also want true multi-connection support. PGlite currently works around Postgres single-user mode; future work is exploring multi-instance and multi-threaded approaches. Replication is another area we are interested in. Logical replication into and out of PGlite would make it a more powerful participant in Postgres systems, not just a local runtime.

`libpglite` is the longer-term ambition: a native embeddable Postgres library for mobile, desktop, and non-JavaScript environments. The goal is embeddable Postgres that can be adopted as broadly as SQLite, while bringing Postgres semantics and tooling with it.

## Try it, build with it, tell us what you make

Try PGlite with `npm install @electric-sql/pglite`. You can find the project on [GitHub](https://github.com/electric-sql/pglite/) and join the [Discord](https://discord.gg/pVASdMED).

Most of all, tell us what you have built, or what you want to build, with embedded Postgres. Thank you to everyone who helped get PGlite here: users, contributors, extension authors, maintainers, and the teams that bet on it early.
