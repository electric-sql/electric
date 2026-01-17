---
title: Writes - Guide
description: >-
  How to do local writes and write-path sync with Electric.
outline: [2, 3]
---

<script setup>
import AuthorizingProxy from '/static/img/docs/guides/auth/authorizing-proxy.png?url'
import AuthorizingProxySmall from '/static/img/docs/guides/auth/authorizing-proxy.sm.png?url'
import AuthorizingProxyJPG from '/static/img/docs/guides/auth/authorizing-proxy.jpg?url'

import GatekeeperFlow from '/static/img/docs/guides/auth/gatekeeper-flow.dark.png?url'
import GatekeeperFlowJPG from '/static/img/docs/guides/auth/gatekeeper-flow.jpg?url'
</script>

<img src="/img/icons/writes.svg" class="product-icon"
    style="width: 72px"
/>

# Writes

How to do local writes and write-path sync with Electric.

Includes patterns for [online writes](#online-writes), [optimistic state](#optimistic-state), [shared persistent optimistic state](#shared-persistent) and [through-the-database sync](#through-the-db).

With accompanying code in the [write-patterns example](https://github.com/electric-sql/electric/tree/main/examples/write-patterns).

## Local writes with Electric

Electric does [read-path sync](/products/postgres-sync). It syncs data out-of Postgres, into local apps and services.

Electric does not do write-path sync. It doesn't provide (or prescribe) a built-in solution for getting data back into Postgres from local apps and services.

So how do you handle local writes with Electric?

Well, the [design philosophy](/blog/2024/07/17/electric-next) behind Electric is to be composable and [integrate with your existing stack](/blog/2024/11/21/local-first-with-your-existing-api). So, just as you can sync into [any client](/docs/guides/client-development) you like, you can implement writes in any way you like, using a variety of different patterns.

## Patterns

This guide describes four different patterns for handling writes with Electric. It shows code examples and discusses trade-offs to consider when choosing between them.

1. [online writes](#online-writes)
2. [optimistic state](#optimistic-state)
3. [shared persistent optimistic state](#shared-persistent)
4. [through-the-database sync](#through-the-db)

All of the patterns use Electric for the read-path sync (i.e.: to sync data from Postgres into the local app) and use a different approach for the write-path (i.e.: how they handle local writes and get data from the local app back into Postgres).

They are introduced in order of simplicity. So the simplest and easiest to implement first and the more powerful but more complex patterns further down &dash; where you may prefer to reach for a [framework](#tools) rather than implement yourself.

> [!Warning] Write-patterns example on GitHub
> This guide has an accompanying [write-patterns example](https://github.com/electric-sql/electric/tree/main/examples/write-patterns) on GitHub. This implements each of the patterns described below and combines them into a single React application.
>
> You can see the example running online at [write-patterns.examples.electric-sql.com](https://write-patterns.examples.electric-sql.com)

<h3 id="online-writes" tabindex="-1" style="display: inline-block">
  1. Online writes
  <a class="header-anchor" href="#online-writes" aria-label="Permalink to &quot;Online writes&quot;">&ZeroWidthSpace;</a>
</h3>
<span class="no-wrap">
  (<a href="https://github.com/electric-sql/electric/tree/main/examples/write-patterns/patterns/1-online-writes">source code</a>)
</span>

The first pattern is simply to use online writes.

Not every app needs local, offline writes. Some apps are read-only. Some only have occasional writes or are fine requiring the user to be online in order to edit data.

In this case, you can combine Electric sync with web service calls to send writes to a server. For example, the implementation in [`patterns/1-online-writes`](https://github.com/electric-sql/electric/tree/main/examples/write-patterns/patterns/1-online-writes) runs a simple Node server (in [`api.js`](https://github.com/electric-sql/electric/blob/thruflo/writes-guide/examples/write-patterns/shared/backend/api.js)) and uses REST API calls for writes:

<<< @../../examples/write-patterns/patterns/1-online-writes/index.tsx{tsx}

#### Benefits

Online writes are very simple to implement [with your existing API](/blog/2024/11/21/local-first-with-your-existing-api). The pattern allows you to create apps that are fast and available offline for reading data.

Good use-cases include:

- live dashboards, data analytics and data visualisation
- AI applications that generate embeddings in the cloud
- systems where writes require online integration anyway, e.g.: making payments

#### Drawbacks

You have the network on the write path. This can be slow and laggy with the user left watching loading spinners. The UI doesn't update until the server responds. Applications won't work offline.

<h3 id="optimistic-state" tabindex="-1" style="display: inline-block">
  2. Optimistic state
  <a class="header-anchor" href="#online-writes" aria-label="Permalink to &quot;Optimistic state&quot;">&ZeroWidthSpace;</a>
</h3>
<span class="no-wrap">
  (<a href="https://github.com/electric-sql/electric/tree/main/examples/write-patterns/patterns/2-optimistic-state">source code</a>)
</span>

The second pattern extends the online pattern above with support for local offline writes with simple optimistic state.

Optimistic state is state that you display "optimistically" whilst waiting for an asynchronous operation, like sending data to a server, to complete. This allows local writes to be accepted when offline and displayed immediately to the user, by merging the synced state with the optimistic state when rendering.

When the writes do succeed, they are automatically synced back to the app via Electric and the local optimistic state can be discarded.

The example implementation in [`patterns/2-optimistic-state`](https://github.com/electric-sql/electric/tree/main/examples/write-patterns/patterns/2-optimistic-state) uses the same REST API calls as the online example above, along with React's built in [`useOptimistic`](https://react.dev/reference/react/useOptimistic) hook to apply and discard the optimistic state.

<<< @../../examples/write-patterns/patterns/2-optimistic-state/index.tsx{tsx}

#### Benefits

Using optimistic state allows you to take the network off the write path and allows you to create apps that are fast and available offline for both reading and writing data.

The pattern is simple to implement. You can handle writes [using your existing API](/blog/2024/11/21/local-first-with-your-existing-api).

Good use-cases include:

- management apps and interactive dashboards
- apps that want to feel fast and avoid loading spinners on write
- mobile apps that want to be resilient to patchy connectivity

#### Drawbacks

This example illustrates a "simple" approach where the optimistic state:

1. is component-scoped, i.e.: is only available within the component that makes the write
2. is not persisted

This means that other components may display inconsistent information and users may be confused by the optimistic state dissapearing if they unmount the component or reload the page. These limitations are addressed by the more comprehensive approach in the next pattern.

<h3 id="shared-persistent" tabindex="-1" style="display: inline-block">
  3. Shared persistent <span class="hidden-xs">optimistic state</span>
  <a class="header-anchor" href="#online-writes" aria-label="Permalink to &quot;Shared persistent optimistic state&quot;">&ZeroWidthSpace;</a>
</h3>
<span class="no-wrap">
  (<a href="https://github.com/electric-sql/electric/tree/main/examples/write-patterns/patterns/3-shared-persistent">source code</a>)
</span>

The third pattern extends the second pattern above by storing the optimistic state in a shared, persistent local store.

This makes offline writes more resilient and avoids components getting out of sync. It's a compelling point in the design space: providing good UX and DX without introducing too much complexity or any heavy dependencies.

This pattern can be implemented with a variety of client-side state management and storage mechanisms. This example in [`patterns/3-shared-persistent`](https://github.com/electric-sql/electric/tree/main/examples/write-patterns/patterns/3-shared-persistent) uses [valtio](https://valtio.dev) with localStorage for a shared, persistent, reactive store. This allows us to keep the code very similar to the simple optimistic state example above (with a valtio `useSnapshot` and plain reduce function replacing `useOptimistic`).

<<< @../../examples/write-patterns/patterns/3-shared-persistent/index.tsx{tsx}

#### Benefits

This is a powerful and pragmatic pattern, occupying a compelling point in the design space. It's relatively simple to implement.

Persisting optimistic state makes local writes more resilient. Storing optimistic state in a shared store allows all your components to see and react to it. This avoids the weaknesses with ephemoral, component-scoped optimistic state and makes this pattern more suitable for more complex, real world apps.

Seperating immutable synced state from mutable local state also makes it easy to reason about and implement rollback strategies. Worst case, you can always just wipe the local state and/or re-sync the server state, without having to unpick some kind of merged mutable store.

Good use-cases include:

- building local-first software
- interactive SaaS applications
- collaboration and authoring software

#### Drawbacks

Combining data on-read makes local reads slightly slower. Whilst a persistent local store is used for optimistic state, writes are still made via an API. This can often be helpful and pragmatic, allowing you to [re-use your existing API](/blog/2024/11/21/local-first-with-your-existing-api). However, you may prefer to avoid this, with a purer local-first approach based on syncing [through a local embedded database](#through-the-db).

#### Implementation notes

The merge logic in the `matchWrite` function differs from the previous optimistic state example in that it supports rebasing local optimistic state on concurrent updates from other users.

The entrypoint for handling rollbacks has the local write context available. So it's able to rollback individual writes, rather than wiping the whole local state.

Because it has the shared store available, it would also be possible to extend this to implement more sophisticated strategies. Such as also removing other local writes that causally depended-on or were related-to the rejected write.

<h3 id="through-the-db" tabindex="-1" style="display: inline-block">
  4. Through the database sync
  <a class="header-anchor" href="#online-writes" aria-label="Permalink to &quot;Through the database sync&quot;">&ZeroWidthSpace;</a>
</h3>
<span class="no-wrap">
  (<a href="https://github.com/electric-sql/electric/tree/main/examples/write-patterns/patterns/4-through-the-db">source code</a>)
</span>

The fourth pattern extends the concept of shared, persistent optimistic state all the way to an embedded local database.

This provides a pure local-first experience, where the application code talks directly to a local database and changes sync automatically in the background. This "power" comes at the cost of increased complexity in the form of an embedded database, complex local schema and loss of context when handling rollbacks.

The example in [`patterns/4-through-the-db`](https://github.com/electric-sql/electric/tree/main/examples/write-patterns/patterns/4-through-the-db) uses [PGlite](https://electric-sql.com/product/pglite) to store both synced and local optimistic state.

Specifically, it:

1. syncs data into an immutable `todos_synced` table
2. persists optimistic state in a shadow `todos_local` table; and
3. combines the two on read using a `todos` view.

For the write path sync it:

4. uses `INSTEAD OF` triggers to
   - redirect writes made to the `todos` view to the `todos_local` table
   - keep a log of local writes in a `changes` table
5. uses `NOTIFY` to drive a sync utility
   - which sends the changes to the server

Through this, the implementation:

- automatically manages optimistic state lifecycle
- presents a single table interface for reads and writes
- auto-syncs the local writes to the server

The application code in [`index.tsx`](https://github.com/electric-sql/electric/blob/main/examples/write-patterns/patterns/4-through-the-db/index.tsx) stays very simple. Most of the complexity is abstracted into the local database schema, defined in [`local-schema.sql`](https://github.com/electric-sql/electric/blob/main/examples/write-patterns/patterns/4-through-the-db/local-schema.sql). The write-path sync utility in [`sync.ts`](https://github.com/electric-sql/electric/blob/main/examples/write-patterns/patterns/4-through-the-db/local-schema.sql) handles sending data to the server.

These are shown in the three tabs below:

:::tabs
== index.tsx
<<< @../../examples/write-patterns/patterns/4-through-the-db/index.tsx{tsx}
== local-schema.sql
<<< @../../examples/write-patterns/patterns/4-through-the-db/local-schema.sql{sql}
== sync.ts
<<< @../../examples/write-patterns/patterns/4-through-the-db/sync.ts{typescript}
:::

#### Benefits

This provides full offline support, shared optimistic state and allows your components to interact purely with the local database, rather than coding over the network. Data fetching and sending is abstracted away behind Electric (for reads) and the sync utility processing the change log (for writes).

Good use-cases include:

- building local-first software
- mobile and desktop applications
- collaboration and authoring software

#### Drawbacks

Using a local embedded database adds quite a heavy dependency to your app. The shadow table and trigger machinery complicate your client side schema definition.

Syncing changes in the background complicates any potential [rollback handling](#rollbacks). In the [shared persistent optimistic state](#shared-persistent) pattern, you can detect a write being rejected by the server whilst in context, still handling user input. With through-the-database sync, this context is harder to reconstruct.

#### Implementation notes

The [merge logic](#merge-logic) in the `delete_local_on_synced_insert_and_update_trigger` in [`./local-schema.sql`](https://github.com/electric-sql/electric/blob/main/examples/write-patterns/patterns/4-through-the-db/local-schema.sql) supports rebasing local optimistic state on concurrent updates from other users.

The rollback strategy in the `rollback` method of the `ChangeLogSynchronizer` in [`./sync.ts`](https://github.com/electric-sql/electric/blob/main/examples/write-patterns/patterns/4-through-the-db/sync.ts) is very naive: clearing all local state and writes in the event of any write being rejected by the server. You may want to implement a more nuanced strategy. For example, to provide information to the user about what is happening and / or minimise data loss by only clearing local-state that's causally dependent on a rejected write.

This opens the door to a lot of complexity that may best be addressed by [using an existing framework](#framework) or one of the [simpler patterns](#patterns).

## Advanced

> [!Warning] This is an advanced section.
> You don't need to engage with these complexities to [get started with Electric](/docs/quickstart).

There are two key complexities introduced by handling offline writes or local writes with optimistic state:

1. merge logic when receiving synced state from the server
2. handling rollbacks when writes are rejected

### Merge logic

When a change syncs in over the Electric replication stream, the application has to decide how to handle any overlapping optimistic state. This can be complicated by concurrency, when changes syncing in may be made by other users (or devices, or even tabs). The third and fourth examples both demonstrate approaches to rebasing the local state on the synced state, rather than just naively clearing the local state, in order to preserve local changes.

[Linearlite](https://github.com/electric-sql/electric/blob/main/examples/linearlite) is another example of through-the-DB sync with more sophisticated merge logic.

### Rollbacks

If an offline write is rejected by the server, the local application needs to find some way to revert the local state and potentially notify the user. A baseline approach can be to clear all local state if any write is rejected. More sophisticated and forgiving strategies are possible, such as:

- marking local writes as rejected and displaying for manual conflict resolution
- only clearing the set of writes that are causally dependent on the rejected operation

One consideration is the indirection between making a write and handling a rollback. When sending write operations directly to an API, your application code can handle a rollback with the write context still available. When syncing through the database, the original write context is much harder to reconstruct.

### YAGNI

[Adam Wiggins](/about/team#angels), one of the authors of the [local-first paper](https://www.inkandswitch.com/local-first/), developed a canvas-based thinking tool called [Muse](https://adamwiggins.com/muse-retrospective/), explicitly designed to support concurrent, collaborative editing of an infinite canvas. Having operated at scale with a large user base, one of his main findings [reported back](https://www.youtube.com/watch?v=WEFuEY3fHd0) at the first local-first meetup in Berlin in 2023 was that in reality, conflicts are extremely rare and can be mitigated well by strategies like presence.

<div style="max-width: 512px; margin: 24px 0">
  <div class="embed-container">
    <YoutubeEmbed video-id="WEFuEY3fHd0" />
  </div>
</div>

If you're crafting a highly concurrent, collaborative experience, you may want to engage with the complexities of merge logic and rebasing local state. However, blunt strategies like those illustrated by the [patterns in this guide](#patterns) can be much easier to implement and reason about &mdash; and are perfectly serviceable for many applications.

## Tools

Below we list some useful tools that work well for implementing writes with Electric.

### Libraries

- [React `useOptimistic`](https://react.dev/reference/react/useOptimistic)
- [React Router](https://reactrouter.com/start/framework/pending-ui)
- [SolidJS](https://docs.solidjs.com/solid-router/reference/data-apis/action)
- [Svelte Optimistic Store](https://github.com/Der-Penz/svelte-optimistic-store)
- [TanStack Query](/docs/integrations/tanstack)
- [Valtio](https://valtio.dev)
- [Vue `vue-useoptimistic`](https://github.com/shoko31/vue-useoptimistic)

### Frameworks

- [LiveStore](/docs/integrations/livestore)
- [TinyBase](https://tinybase.org)
- [tRPC](https://github.com/KyleAMathews/trpc-crdt)

See also the list of local-first projects on the [alternatives page](/docs/reference/alternatives#local-first).
