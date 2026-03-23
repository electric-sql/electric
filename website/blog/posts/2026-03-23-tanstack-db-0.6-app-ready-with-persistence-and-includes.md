---
title: 'Electric apps get persistence and includes with TanStack DB 0.6'
description: >-
  TanStack DB 0.6 adds persistence and includes. For Electric users, that means
  a more complete app data stack with durable local state and
  application-shaped queries, adopted incrementally and fully opt-in.
excerpt: >-
  TanStack DB 0.6 is a big unlock for Electric users. Persistence plus includes
  makes the Electric + TanStack DB stack more app-ready while staying optional,
  composable, and incrementally adoptable.
authors: [samwillis, kevindeporre]
image: /img/blog/tanstack-db-0.6-app-ready-with-persistence-and-includes/header.jpg
tags: [tanstack-db, local-first, release]
outline: [2, 3]
post: true
published: false
---

TanStack DB 0.6 lands two features many teams were waiting for: persistence and includes.

For Electric users, this is more than a point release. With persisted local state, app restarts can stay warm instead of cold. With includes, query results can match UI shape without custom projection layers. Together with Electric sync, this gives you a fuller local-first stack that is still optional, composable, and incrementally adoptable.

> [!TIP]
> **Key links**
> - TanStack release post: [TanStack DB 0.6 now includes persistence, offline support, and hierarchical data](https://tanstack.com/blog/tanstack-db-0-6-now-includes-persistence-offline-support-and-hierarchical-data)
> - Electric + TanStack DB guide: [Build super-fast apps on sync with TanStack DB](/blog/2025/07/29/super-fast-apps-on-sync-with-tanstack-db)
> - Incremental adoption guide: [Local-first with your existing API](/blog/2024/11/21/local-first-with-your-existing-api)
> - Electric docs: [Introduction](/docs/intro), [Quickstart](/docs/quickstart)
> - Shape docs: [Shapes](/docs/guides/shapes)

## Context

Electric and TanStack DB pair naturally: Electric syncs normalized shapes from Postgres to clients using incremental sync, and TanStack DB handles local query execution, optimistic state, and reactive UI updates.

That stack already delivered fast, sync-powered apps. The missing piece for many teams was durable local state across reloads and restarts. TanStack DB 0.6 closes that gap with SQLite-backed persistence across browser, Node, React Native, Expo, Capacitor, and edge runtimes like Cloudflare Durable Objects.

0.6 also adds includes, which let you compose subqueries in `select` and project that normalized synced data into hierarchical UI-shaped results. In practice, this gives you a GraphQL-like projection model from a single declarative live query, but powered by Electric sync plus TanStack DB's reactive query engine.

## What's shipping

- **Persistence across runtimes.** Local state can survive app restarts, not just tab lifetime, and works across browser, Node, mobile runtimes, and edge environments.
- **Includes for hierarchical projections.** Electric keeps sync normalized; includes let you project that into GraphQL-like UI shapes from one declarative reactive live query instead of hand-rolled per-screen projection code.
- **A more complete app data stack.** Electric sync + TanStack DB query engine + optimistic updates + durable local state is now practical in one composable architecture.
- **No all-or-nothing migration.** These capabilities are opt-in and incremental. You can add persistence and includes collection-by-collection where they matter.

## Why this matters for Electric users

Over the last four years, one lesson has repeated across teams: local-first needs to be practical, not doctrinal. Teams want server authority where it matters, optimistic UX where it helps, and durable local behavior where product requirements demand it.

TanStack DB 0.6 fits that reality.

You can start with Electric sync and live queries. Add persistence to high-value collections that need warm restarts and offline durability. Add includes where your UI needs nested, application-shaped results from normalized synced data. Keep writes explicit through your existing API and transaction contracts.

This gives teams a complete app data model they can adopt in practice: fully opt-in, fully composable, and fully incremental.

## Get started

Read the full TanStack announcement first for API details and migration notes, then apply the Electric angle in a small slice of your app.

1. Start from an Electric + TanStack DB setup:
   - [Electric + TanStack DB guide](/blog/2025/07/29/super-fast-apps-on-sync-with-tanstack-db)
   - [Electric quickstart](/docs/quickstart)
2. Add persistence to one high-value collection first (for example inbox, tasks, drafts, or threads).
3. Add includes to one UI surface where projection code is currently noisy.
4. Expand gradually, based on product value, not ideology.

Persistence example:

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

## Coming next

- More production examples of Electric + TanStack DB with persistence enabled.
- More patterns for includes-based UI projection with fine-grained reactivity.
- Ongoing collaboration on SSR and hydration patterns as TanStack DB moves toward v1.

## Next steps

If you are starting a new app, this is a good time to start with Electric + TanStack DB and adopt persistence and includes where they provide immediate product value.

- [Read the TanStack DB 0.6 post](https://tanstack.com/blog/tanstack-db-0-6-now-includes-persistence-offline-support-and-hierarchical-data)
- [Build with Electric + TanStack DB](/blog/2025/07/29/super-fast-apps-on-sync-with-tanstack-db)
- [Try the Electric quickstart](/docs/quickstart)
- [Join Discord](https://discord.electric-sql.com)

***

<!--
DELETE THIS FOOTER BEFORE PUBLISHING

Asset checklist
- [ ] Verify exact TanStack post URL slug
- [ ] Add header image at `/img/blog/tanstack-db-0.6-app-ready-with-persistence-and-includes/header.jpg`
- [ ] Swap sample snippet for production snippet (optional)
- [ ] Add optional diagram or warm-restart screenshot/GIF

Open questions
- Keep as text-first, or add a short demo embed?

Typesetting checklist
- [ ] Use sentence case for title
- [ ] Check for widows/orphans and add non-breaking spaces/hyphens where needed
- [ ] Verify title, header image, and body layout on mobile and desktop widths
- [ ] Remove generic/LLM filler phrasing during prose pass
-->

