---
title: 'Electric apps get persistence and includes with TanStack DB 0.6'
description: >-
  TanStack DB 0.6 adds persistence and includes. For Electric users, that means
  a more complete app data stack with persistence and nested query results,
  adopted incrementally.
excerpt: >-
  TanStack DB 0.6 is a major update for Electric users. Persistence and includes
  make the Electric + TanStack DB stack more app-ready while staying
  incrementally adoptable.
authors: [samwillis, kevindeporre]
image: /img/blog/tanstack-db-0.6-app-ready-with-persistence-and-includes/header.jpg
tags: [tanstack-db, local-first, release]
outline: [2, 3]
post: true
published: true
---

TanStack DB 0.6 adds two core features: persistence and includes.

For Electric users, this is more than a point release. With persisted local state, app restarts are fast since data can be loaded locally from disk. With includes, query results can match UI shape without custom projection layers.

Together with [Postgres&nbsp;Sync](/products/postgres-sync) and [Durable&nbsp;Streams](/products/durable-streams), this gives you a more complete local-first stack that is still optional, composable, and incrementally adoptable.

> [!WARNING] 🪧&nbsp; Quicklinks
> - TanStack release post: [TanStack DB 0.6 now includes persistence, offline support, and hierarchical data](https://tanstack.com/blog/tanstack-db-0-6-now-includes-persistence-offline-support-and-hierarchical-data)
> - Electric + TanStack DB guide: [Build super-fast apps on sync with TanStack DB](/blog/2025/07/29/super-fast-apps-on-sync-with-tanstack-db)
> - Incremental adoption guide: [Local-first with your existing API](/blog/2024/11/21/local-first-with-your-existing-api)
> - Electric docs: [Introduction](/docs/intro), [Quickstart](/docs/quickstart)
> - Shape docs: [Shapes](/docs/guides/shapes)

## How this fits the Electric stack

Electric and TanStack&nbsp;DB pair naturally: [Postgres&nbsp;Sync](/products/postgres-sync) syncs normalized shapes from Postgres to clients using incremental sync, and TanStack&nbsp;DB handles local query execution, optimistic state, and reactive UI updates. [Durable&nbsp;Streams](/products/durable-streams) extends the same model beyond Postgres — real-time event data, AI sessions, and collaborative state all flow through TanStack&nbsp;DB collections via [StreamDB](https://durablestreams.com/stream-db).

That stack already delivered fast, sync-powered apps. What was missing was local state that survives reloads and restarts. TanStack&nbsp;DB 0.6 closes that gap with SQLite-backed persistence across browser, Node, React&nbsp;Native, Expo, Capacitor, and edge runtimes like Cloudflare Durable Objects.

TanStack&nbsp;DB 0.6 also introduces includes, which let you nest subqueries in `select` and project normalized synced data into hierarchical UI-shaped results. In practice, this gives you a GraphQL-like projection model from a single declarative live query, powered by Electric's sync primitives and TanStack&nbsp;DB's reactive query engine.

If you've been following Electric's evolution, this is worth pausing on. When we [rewrote Electric](/blog/2024/07/17/electric-next) we deliberately narrowed scope to the sync engine and let go of the full client-side database layer. TanStack&nbsp;DB 0.6 builds that layer back — persistence, rich queries, offline support — but this time as a standalone, framework-native library that composes with Electric rather than being locked into it.

## What's shipping

- **Persistence across runtimes.** Local state can survive app restarts, not just tab lifetime, and works across browser, Node, mobile runtimes, and edge environments.
- **Includes for nested UI data.** Electric keeps sync normalized; includes let you query nested UI-ready results without per-screen glue code.
- **No all-or-nothing migration.** These capabilities are opt-in and incremental. You can add persistence and includes collection-by-collection where they matter.

## Why this matters

Local-first needs to be practical, not doctrinal. You want server authority where it matters, optimistic UX where it helps, and offline availability where product requirements demand it.

TanStack DB 0.6 fits that reality.

You can start with Electric sync and live queries. Add persistence to high-value collections that need fast restarts and offline availability. Add includes where your UI needs nested results. Keep writes explicit through your existing API and transaction contracts.

This gives you a complete app data model you can adopt incrementally.

## Shopping list demo app

The React Native shopping list demo shows this stack end to end: an Electric collection syncing in real time, with state persisted locally through SQLite for offline support.

<div class="embed-container">
  <YoutubeEmbed video-id="EBXOjQds8hU" />
</div>

It starts from persisted SQLite state through `op-sqlite`, projects normalized data into nested UI structures with includes, and keeps TanStack DB's fine-grained reactivity underneath. Paired with [`@tanstack/offline-transactions`](https://github.com/TanStack/db/tree/main/packages/offline-transactions), this turns "fast while open" into practical local-first behavior across restarts and offline sessions.

## Get started

A practical way to start is with one focused app slice, then expand as you go.

### 1) Start with the baseline stack

Begin from an Electric + TanStack DB setup:

- [Electric + TanStack DB guide](/blog/2025/07/29/super-fast-apps-on-sync-with-tanstack-db)
- [Electric quickstart](/docs/quickstart)

### 2) Add persistence where it pays off first

Pick one high-value collection and persist it across restarts.

Persistence example:

This example uses the React Native/Expo SQLite adapter; browser and Node use equivalent persistence adapters with the same pattern.

```ts
import { open } from '@op-engineering/op-sqlite'
import { createCollection } from '@tanstack/db'
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import {
  createReactNativeSQLitePersistence,
  persistedCollectionOptions,
} from '@tanstack/db-react-native-sqlite-persisted-collection'

const database = open({
  name: 'electric-app.sqlite',
  location: 'default',
})

const persistence = createReactNativeSQLitePersistence({ database })

// Add persistence to one Electric-backed collection.
const items = createCollection(
  persistedCollectionOptions({
    persistence,
    schemaVersion: 1,
    ...electricCollectionOptions({
      id: 'items',
      schema: itemSchema,
      getKey: (row) => row.id,
      shapeOptions: { url: '/api/items' },
      onInsert: async ({ transaction, collection }) => {
        const { txid } = await api.items.create(transaction.mutations[0].modified)
        await collection.utils.awaitTxId(txid)
      },
    }),
  }),
)
```

### 3) Add includes where projection code is noisy

Pick one UI surface with manual shaping logic and replace it with an includes-based live query over normalized synced data.

Includes example:

```ts
import { createLiveQueryCollection, eq } from '@tanstack/db'

// Electric sync stays normalized; includes project into UI shape.
const projectsWithIssues = createLiveQueryCollection((q) =>
  q.from({ p: projectsCollection }).select(({ p }) => ({
    id: p.id,
    name: p.name,
    issues: q
      .from({ i: issuesCollection })
      .where(({ i }) => eq(i.projectId, p.id))
      .select(({ i }) => ({
        id: i.id,
        title: i.title,
        status: i.status,
      })),
  })),
)
```

This pattern keeps sync normalized and declarative while giving your UI a GraphQL-like hierarchical projection from one reactive live query.

### 4) Expand incrementally

Once one slice is working well, extend the same pattern to the next collections and screens.

## Next steps

If you're starting a new app, begin with Electric + TanStack DB and add persistence and includes where they help.

- [Read the TanStack DB 0.6 post](https://tanstack.com/blog/tanstack-db-0-6-now-includes-persistence-offline-support-and-hierarchical-data)
- [Build with Electric + TanStack DB](/blog/2025/07/29/super-fast-apps-on-sync-with-tanstack-db)
- [Try the Electric quickstart](/docs/quickstart)
- [Join Discord](https://discord.electric-sql.com)

