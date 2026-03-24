---
title: 'Announcing PGlite v0.4: PostGIS, connection multiplexing, and a new architecture'
description: >-
  An overview of what has been keeping us busy lately and what are PGlite's plans for the future.
excerpt: >-
  PGlite has seen amazing growth in the last year. This is an overview of PGlite's most important developments 
  and what's ahead for embedded Postgres.  
authors: [samwillis]
image: /img/blog/announcing-pglite-v04/hero.jpg
imageWidth: 2752
imageHeight: 1536
tags: [PGlite, PostGIS, Postgres]
outline: [2, 3]
post: true
published: false
---

<!-- TLDR opener: this IS the pitch. No setup. State what shipped and why it matters. -->

PGlite v0.4 is out. This release brings PostGIS support, connection multiplexing, and a major architectural refactor that decouples `initdb` from the main WASM binary — setting up PGlite's foundation for native ports and multi-connection support.

PGlite now sees over 13&nbsp;million weekly downloads across all packages. From CI&nbsp;testing to [vibe coding with a database in the sandbox](https://electric-sql.com/blog/2025/06/05/database-in-the-sandbox), PGlite is showing up everywhere. Here's what's new.

:::info
[PGlite](https://pglite.dev/) is a WASM build of Postgres that runs inside your JavaScript environment — in the browser, Node.js, Bun, and Deno.

- [v0.4 release on GitHub](https://github.com/electric-sql/pglite/releases)
- [Extension catalog](https://pglite.dev/extensions/)
- [Discord](https://discord.gg/pVASdMED) · [GitHub](https://github.com/electric-sql/pglite/)
:::

## What's new in v0.4

<!-- Lead with benefits, follow with specifics. Each item is something you can now do. -->

### A cleaner architecture

<!-- The initdb refactor. Technical, but the payoff is clear: less fork divergence, easier contributions, sets up the future. -->

A guiding principle for PGlite is keeping our [Postgres fork](https://github.com/electric-sql/postgres-pglite) as close to upstream as possible. The less we change, the easier it is to upgrade, maintain, and accept contributions. We rely on [vanilla Emscripten](https://emscripten.org/) for the build and keep external build dependencies in a [Docker builder](https://hub.docker.com/r/electricsql/pglite-builder) so the environment is reproducible on any host.

The biggest win in v0.4 is refactoring how `initdb` works. Previously, `initdb` was embedded inside the final WASM executable, requiring hacks that had to be maintained across fork updates. Now, `initdb` runs as a separate WASM process. PGlite intercepts its system calls to provide the necessary plumbing — stdin/stdout redirection and filesystem sharing via Emscripten's [PROXYFS](https://emscripten.org/docs/api_reference/Filesystem-API.html#filesystem-api-proxyfs) — without changing any `initdb` code.

<figure>
  <img src="/img/blog/announcing-pglite-v04/initdbpostgres.svg" alt="initdb PostgreSQL plumbing in PGlite" />
  <figcaption class="figure-caption text-end text-small mb-3 mb-9 max-w-lg ml-auto">initdb and Postgres are separate WASM processes — PGlite provides the communication plumbing by intercepting system calls</figcaption>
</figure>

This mirrors how a native PostgreSQL deployment works, making the codebase easier to understand for new contributors. The same pattern extends to other Postgres client tools without needing changes to their code.

### PostGIS

<!-- The long-awaited one. Lead with what it unlocks. -->

[PostGIS](https://postgis.net/) adds support for storing, indexing, and querying geospatial data. For many developers, it's the reason they choose Postgres. Now it runs in PGlite.

Getting here wasn't trivial. PostGIS has many dependencies, all of which needed WASM builds. Chrome's [8MB limit on synchronously loading dynamic libraries](https://chromestatus.com/feature/5099433642950656) added another constraint. The community stepped in and helped us deliver it.

Big shoutout to [@StachowiakDawid](https://github.com/StachowiakDawid) and [@larsmennen](https://github.com/larsmennen) for their work on this.

### Connection multiplexing

<!-- Community-driven, practical unlock. -->

PGlite runs in Postgres [single-user mode](https://www.postgresql.org/docs/current/app-postgres.html), which means a single connection. Many client tools expect to open multiple connections, and this has been a friction point.

[@nickfujita](https://github.com/nickfujita) contributed a PR that multiplexes concurrent connections over PGlite's single connection. This unblocks compatibility with tooling that previously couldn't work with PGlite's single-connection constraint.

### Community extensions

<!-- Celebrate the ecosystem without belaboring it. -->

The community has taken our [extension build docs](https://pglite.dev/extensions/development#building-postgres-extensions) and run with them. Extensions now shipping in production include [pg_uuidv7](https://github.com/fboulnois/pg_uuidv7), [pgTAP](https://pgtap.org/), [pg_hashids](https://github.com/iCyberon/pg_hashids), and [Apache AGE](https://github.com/electric-sql/pglite/pull/860). Thanks also to [@loredanacirstea](https://github.com/loredanacirstea) for help bringing [pgcrypto](https://www.postgresql.org/docs/current/pgcrypto.html) to PGlite.

These come on top of the contrib extensions we bundle by default. See the full [extension catalog](https://pglite.dev/extensions/).

## Growth

<!-- Brief social proof. Not a backstory — just enough to show momentum. -->

Over the past year, PGlite has grown from ~500k to over 13&nbsp;million weekly downloads across all packages. [Prisma](https://www.prisma.io/) now [bundles PGlite](https://www.prisma.io/docs/postgres/database/local-development) in their CLI for local development — try it with `npx prisma dev`. We're seeing growing community activity [on HN](https://news.ycombinator.com/item?id=46146133), more external PRs on [GitHub](https://github.com/electric-sql/pglite/), and adoption across CI/CD pipelines, browser-based IDEs, and developer tooling.

## Get started

Install PGlite:

```bash
npm install @electric-sql/pglite
```

Basic usage:

```typescript
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
await db.exec('CREATE TABLE test (id serial PRIMARY KEY, name text)')
await db.exec("INSERT INTO test (name) VALUES ('hello')")
const result = await db.query('SELECT * FROM test')
```

Check out the [extension catalog](https://pglite.dev/extensions/) to add PostGIS, pgvector, and more.

## Coming next

<!-- Brief roadmap tease. 2-3 bullets, keep momentum. -->

- **libpglite** — a native library built directly from Postgres source, with bindings for multiple languages. This unlocks mobile and desktop use cases, starting with React&nbsp;Native.
- **Multi-instance** — true multi-connection support, exploring both cooperative and multi-threaded (WebWorker) approaches. We're also monitoring the [threading work in Postgres](https://wiki.postgresql.org/wiki/Multithreading) as a longer-term path.
- **Replication** — enabling Postgres logical replication to expand what PGlite can participate in.

***

Join us on [Discord](https://discord.gg/pVASdMED), star us on [GitHub](https://github.com/electric-sql/pglite/), and check out the [PGlite docs](https://pglite.dev/) to get started.

Many thanks to all our contributors and users — your support keeps us going.

<!-- ============================================================
DELETE EVERYTHING BELOW THIS LINE BEFORE PUBLISHING

## Meta

### Intent
- **What is this post about?** PGlite v0.4 shipped with PostGIS, connection multiplexing, and a major architecture refactor.
- **What's interesting?** PostGIS in the browser. Connection multiplexing removes a real friction point. The architecture refactor is elegant engineering — decoupling initdb, minimizing fork divergence.
- **Reader takeaway:** PGlite v0.4 is a serious release with production-ready extensions and cleaner internals. The roadmap (libpglite, React Native, multi-instance, replication) is credible because of the foundation laid in this release.
- **CTAs:** Install PGlite, explore extensions, join community.
- **Authority:** The PGlite team built it.

### Title brief
"Announcing PGlite v0.4: PostGIS, connection multiplexing, and a new architecture"
— Names the version, lists the headline features, signals substance. HN-friendly.
Alternative shorter: "PGlite v0.4 ships PostGIS and connection multiplexing"

### Description brief (SEO, no HTML)
Describe what shipped: PGlite v0.4 with PostGIS, connection multiplexing, architecture refactor, community extensions. Mention the growth number (13M downloads). Keep under 160 chars.

### Excerpt brief (blog listing card, max 3 short sentences)
Lead with "PGlite v0.4 is out" and name the headline features. Keep to 2-3 sentences matching the length of other blog listing excerpts.

### Image prompt
Reuse the existing hero image from the state-of-pglite post, or create a new one:
- Subject: PGlite v0.4 release — Postgres elephant + WASM/browser motif
- Aspect: 16:9 (~2752x1536)
- Dark background, brand colors (#D0BCFF purple, #00d2a0 green, #75fbfd cyan)
- Center-center composition

### Asset checklist
- [x] initdb/postgres plumbing SVG (exists: /img/blog/announcing-pglite-v04/initdbpostgres.svg)
- [x] Hero image (exists: /img/blog/announcing-pglite-v04/hero.jpg)
- [ ] Fill in title, description, excerpt in frontmatter
- [ ] Decide on hero image: reuse or new?
- [ ] Verify 13M downloads figure and qualifier wording with thruflo

### Typesetting checklist
- [ ] Non-breaking spaces for "13 million", "React Native", etc.
- [ ] Sentence case in title (done)
- [ ] Check title and post at different screen widths
- [ ] No LLM tells

### Open questions
- Downloads figure: 13M "across all packages" — confirm exact qualifier with thruflo
- Hero image: reuse from state-of-pglite post or commission new one for this post?
- Should the Blacksmith CI mention stay? (Currently omitted as it felt tangential to the release. Could add a one-liner in the architecture section if wanted.)
============================================================ -->
