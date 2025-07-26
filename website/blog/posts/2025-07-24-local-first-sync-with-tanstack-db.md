---
title: Local-first sync with TanStack DB
description: >-
  Tanstack DB is a reactive client store for building super fast apps on sync.
  Paired with Electric, it provides an optimal end-to-end sync stack for
  local-first app development.
excerpt: >-
  Tanstack DB is a reactive client store for building super fast apps on sync.
  Paired with Electric, it provides an optimal end-to-end sync stack for
  local-first app development.
authors: [thruflo]
image: /img/blog/local-first-sync-with-tanstack-db/header2.jpg
tags: [db]
outline: [2, 3]
post: true
---

<script setup>
import Tweet from 'vue-tweet'
</script>

<style scoped>
  figure {
    background: #161618;
    border-radius: 14px;
    margin: 28px 0;
  }
  figure#tanstack-db-image {
    margin: -40px 0;
  }
  h2#introducing-tanstack-db {
    border: none;
  }
  .embed-container {
    margin: 28px 0;
  }
</style>

[Tanstack DB](https://tanstack.com/db) is a reactive client store for building super fast apps on sync.

It's type-safe, declarative, incrementally adoptable and insanely fast. Combined with Electric, it gives you real-time without the re-write and sync that just works. A new unified standard for sync and an optimal, end-to-end local-first sync stack.

It's the future of app development with Electric and hands down the best way of building the next generation of AI apps and agentic systems.

> [!Warning] ✨&nbsp; TanStack DB <> Electric starters
> You can fire up TanStack DB with Electric using the [TanStack Start starter](https://github.com/KyleAMathews/tanstack-start-db-electric-starter) and [Expo starter](https://github.com/KyleAMathews/expo-db-electric-starter) templates. Docs are at [tanstack.com/db](https://tanstack.com/db) and there's an [example app](https://github.com/TanStack/db/tree/main/examples/react/todo) in the repo.

## The next frontier for front-end

Front-end has long been about reactivity frameworks and client-side state management. However, the alpha in these is receding. The next frontier, with much bigger gains across UX, DX and AX lies in [local-first, sync engine architecture](/use-cases/local-first-software).

Sync-based apps like [Linear](https://linear.app/blog/scaling-the-linear-sync-engine) and [Figma](https://www.figma.com/blog/how-figmas-multiplayer-technology-works) feel instant to use and are naturally collaborative. Eliminating stale data, loading spinners and manual data wiring by design.

It's an ideal architecture for [building AI apps and agentic systems](/blog/2025/04/09/building-ai-apps-on-sync) and makes LLM-generated code [more maintainable and production ready](/blog/2025/04/22/untangling-llm-spaghetti).

## Adding local-first sync to TanStack

[TanStack](https://tanstack.com) is a collection of TypeScript libraries for building web and mobile apps. Developed by an open collective, stewarded with great taste by [Tanner Linsley](https://github.com/tannerlinsley), it's one of the best and most popular ways to build modern apps.

Tanner has long wanted to add local-first sync to TanStack:

<blockquote><em>&ldquo;I think ideally every developer would love to be able to interact with their APIs as if they were local-first. I have no doubt that that is what everybody wants.&rdquo;</em></blockquote>

<div class="embed-container">
  <YoutubeEmbed video-id="hy9pNJMFfyM" />
</div>

When Electric co-founder [Kyle Mathews](/about/team#kyle) approached Tanner with the idea to work on this, they immediately aligned on a vision for an ideal developer experience for incrementally adoptable local-first app development. There was still once piece missing though: a reactive query engine fast enough to make the vision a reality.

Enter [Sam Willis'](/about/team#sam) work on [d2ts](https://github.com/electric-sql/d2ts), a Typescript implementation of differential dataflow that can handle even the most complex reactive queries in microseconds.

Suddenly we had all the primitives: the stack, the DX, the sync engine and a query engine fast enough to make it possible. To understand how this then came together in TanStack DB, let's briefly refresh on how TanStack works.

### How TanStack works

TanStack grew out of React Query, now [TanStack Query](https://tanstack.com/query), a library that gives you managed queries, caching, mutation primitives, etc.

This is TanStack Query code to read data into a React component:

```tsx
import { useQuery } from '@tanstack/react-query'

function Todos() {
  const { data } = useQuery({
    queryFn: async () => await api.get('/todos'),
    queryKey: ['todos']
  })

  // ...
}
```

You provide a `queryFn` that defines how you fetch your data. TanStack Query then [manages calling it, retries, caching](https://tanstack.com/query/latest/docs/framework/react/overview#motivation) etc.

For writes, you create a mutation with a `mutationFn` that defines how you actually send your data to the server (in this case by posting it to your API):

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query'

function Todos() {
  const queryClient = useQueryClient()

  const { mutate } = useMutation({
    mutationFn: (todo) => api.post('/todos', todo),
    onSettled: () => queryClient.invalidateQueries({
      queryKey: ['todos']
    })
  })

  // continues below ...
}
```

You can then use this mutation in your components to make instant local writes, with TanStack Query managing the [optimistic state lifecycle](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) for you:

```tsx
function Todos() {
  // ... as above

  const addTodo = () => mutate({title: 'Some Title' })

  return <Button onClick={ addTodo } />
}
```

### Adding support for local-first sync

So, we see that TanStack already handles data loading and local optimistic writes. What exactly do we need to add to TanStack for it to support local-first sync?

Well, local-first application code talks directly to a local store interface. This takes the [network off the interaction path](/use-cases/data-sync#replace-data-fetching-with-data-sync) and [abstracts data transfer and placement](/blog/2022/12/16/evolution-state-transfer#optimal-placement-and-movement-of-data) out of the app code (into the sync engine where it can be system optimized).

So, the first thing we need is a local store primitive to sync data in-and-out-of that the app code can interact with. Let's call it a **Collection**.

<figure>
  <a class="no-visual" target="_blank"
      href="/img/blog/local-first-sync-with-tanstack-db/collection.lg.jpg">
    <img src="/img/blog/local-first-sync-with-tanstack-db/collection.png?v=2" />
  </a>
</figure>

Then for local reads, we need **Live&nbsp;Queries** to query and join data across collections.

These need to be reactive and extremely efficient. Reactive keeps your components from having stale data. Extremely efficient stops your app grinding to a halt [when your component tree and data size grows](https://riffle.systems/essays/prelude) in a real world application.

<figure>
  <a class="no-visual" target="_blank"
      href="/img/blog/local-first-sync-with-tanstack-db/live-queries.lg.jpg">
    <img src="/img/blog/local-first-sync-with-tanstack-db/live-queries.png" />
  </a>
</figure>

And for local writes, we need **Optimistic Mutations** that can apply optimistic state to collections. These need to be transactional, so local writes can be applied atomically across collections. And they need to tie the optimistic state lifecycle in with the sync machinery &mdash; so we keep the app code clean and don't leak data transfer concerns back into the application domain.

<figure>
  <a class="no-visual" target="_blank"
      href="/img/blog/local-first-sync-with-tanstack-db/sync-on-sync-off.lg.jpg">
    <img src="/img/blog/local-first-sync-with-tanstack-db/sync-on-sync-off.png" />
  </a>
</figure>

If we have these three things:

1. collections with sync support
2. highly efficient, cross-collection live queries
3. transactional mutations that tie into the sync machinery

Then we have a local-first sync stack built natively into TanStack.

<h2>&nbsp;</h2>

<figure id="tanstack-db-image">
  <a class="no-visual" target="_blank"
      href="https://tanstack.com/db">
    <img src="/img/blog/local-first-sync-with-tanstack-db/tanstack-db.jpg" />
  </a>
</figure>

## Introducing TanStack DB

[TanStack DB](https://tanstack.com/db) is a reactive client store that extends TanStack Query with:

- collections
- live queries
- transactional mutations

It allows you to *incrementally* migrate existing API-based apps to local-first sync and build real-time apps that are resilient, reactive and, as we’ll see, insanely fast 🔥

Let’s dive it and see how it works!

### Collections

Collections are typed sets of objects that can be populated with data. You can populate data in many ways, for example by:

- fetching data, for example from API endpoints using TanStack Query
- syncing data, for example using sync engines like Electric and Materialize

You can also store local client data and derive collections from live queries (creating new collections as materialised views).

#### Query collections

Query collections fetch data using TanStack Query.

```ts
import { QueryClient } from '@tanstack/query-core'
import { queryCollectionOptions } from '@tanstack/query-db-collection'
import { createCollection } from '@tanstack/react-db'

const queryClient = new QueryClient()

const queryTodoCollection = createCollection(
  queryCollectionOptions({
    id: 'fetch-todos',
    queryKey: ['todos'],
    queryFn: async () => await api.get('/todos'),
    getKey: (item) => item.id,
    schema: todoSchema, // any standard schema
    queryClient
  })
)
```

We’ve seen the heart of this before, right? It fetches data using a managed `queryFn`.

This allows you to take existing API-based applications and incrementally layer on TanStack DB where you need it, with minimal changes to your code.

It also allows you to load data into your app from a variety of sources: anything that provides or can be wrapped by an API. That can be your backend API but can also be an external service, like an auth service or a weather API.

You can then configure polling or call `invalidate()` on the TanStack `queryClient` to fetch fresh data into the collection:

```ts
queryClient.invalidateQueries({
  queryKey: ['todos']
})
```

This is a practical way of updating the data in an API-backed collection. However, it's based on re-fetching, which is neither as fast nor as efficient as real-time sync.

#### Sync collections

Sync collections automatically and efficiently keep the data in the collection up-to-date. You don't need to tell a sync-based collection to re-fetch data. It always keeps the local data live and up-to-date in real-time for you.

There are already a number of built-in TanStack DB collections for different sync engines, including [Electric](/), [Materialize](https://materialize.com) and [Trailbase](https://trailbase.io).

To create a collection that syncs data using Electric, you use the same options that you’d pass to the [Electric client](/docs/api/clients/typescript) when defining a [Shape](/docs/guides/shapes). A shape is a [filtered view on a database table](/docs/guides/shapes#where-clause) that Electric syncs into the client for you:

```ts
import { electricCollectionOptions } from '@tanstack/electric-db-collection'
import { createCollection } from '@tanstack/react-db'

const electricTodoCollection = createCollection(
  electricCollectionOptions({
    id: 'sync-todos',
    shapeOptions: {
      url: 'http://localhost:3003/v1/shape',
      params: {
        table: 'todos',
      }
    },
    getKey: (item) => item.id,
    schema: todoSchema
  })
)
```

This keeps the collection in sync with the `todos` table in your Postgres database.

You can create as many filtered views as you like on the same table. For example, syncing just your todos created since the 1st January 2025:

```ts
const myRecentTodoCollection = createCollection(
  electricCollectionOptions({
    id: 'sync-my-recent-todos',
    shapeOptions: {
      url: 'http://localhost:3003/v1/shape',
      params: {
        table: 'todos',
        where: `
          user_id='${currentUser.id}
          AND
          inserted_at >= '2025-01-01'
        `
      }
    },
    getKey: (item) => item.id,
    schema: todoSchema
  })
)
```

#### Other collections

There are a range of other collections also built into TanStack DB. Such as an ephemoral [local collection](https://github.com/TanStack/db/blob/main/packages/db/src/local-only.ts) and a persistent [localStorage collection](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts). You can also easily create your own collections by following the [collection options creator guide](https://tanstack.com/db/latest/docs/collection-options-creator).

However it gets there, once you have data in collections, you can bind it to your components using live queries.

### Live queries

[Live queries](https://tanstack.com/db/latest/docs/live-queries) run reactively against and across collections. They're fast and expressive, with support for joins, filters and aggregates.

There's a number of ways to build and use them. The most common is in your components [using a `useLiveQuery` hook or equivalent:

```tsx
import { useLiveQuery, eq } from '@tanstack/react-db'

const Todos = () => {
  const { data } = useLiveQuery((query) =>
    query
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.completed, true))
  )

  return <List items={ data } />
}
```

This keeps the value of the `data` state variable in sync with the contents of your collection. Which, if you're using an Electric collection, is in sync with the contents of your database. So any write to Postgres will sync into your app in real-time and then instantly trigger the component to re-render (if the value has changed, using your reactivity framework of choice).

As you can see, there's no manual data wiring and your component code has no knowledge, or care, about where the data in the collection came from. Data fetching is entirely abstracted out of the component code.

#### Cross-collection queries

You can query across as many collections as you like. They can be collections of different types. So you can use the collection primitive to load/sync/save data from different sources. And then use live queries to query across them as part of the same logical data model.

You can have as many complex queries as you like, with joins, aggregates, etc.

... examples ...

#### Collections all the way down

You can also derive collections from live queries. In fact, live queries *are* collections.

You can create a live query based collection using `createCollection`, creating new collections as materialised views derived from your synced or loaded data:

```ts
// ...
```

You can also access live query results as collection in your components:

```ts
// ...
```

This allows you to compose a pipeline of layered queries, materializing as a collection when you want to cache a layer of the pipeline. So collections and live queries are composable and it's collections all the way down.

### Mutations

And to write data locally.
Rather than the `useMutation` hook we saw before with TanStack Query.

You define ... mutators / transactions ...

And *if you want*, the mutationFn can be exactly the same as it would be with React Query
You can handle mutations by posting to specific API endpoints.

But if you choose to, you can incrementally move to write-path sync with a …
… generic mutationFn.

So, what we’re doing here is whenever there’s a local transaction — applying changes to any collection post all the mutations to the backend, to a generic ingest endpoint. If it errors for any reason, the local transaction is rolled back If it succeeds, the server returns the txid that the changes were written into Postgres under
Then we monitor the replication stream for that transaction.

This is both simple and pragmatic
server authoritative, you have rollbacks
but also quite sophisticated
=> allows the local optimistic state to be rebased over concurrent transactions from other users

Then on the server side you can just … ingest the changes.

Obviously in any language or framework you like.
This works with *your API*, your stack.

You can see reference implementations in our examples using Hono and in the Phoenix.Sync.Writer module for the Phoenix.Sync library in Elixir, e.g.:

... code ...

## Optimal sync stack

When TanStack DB is paired with Electric, it gives you an optimal, end-to-end local-first sync stack. The combination is insanely fast, scalable, declarative, type-safe, reactive, composable, extensible and incrementally adoptable.

### Fast and scalable

You can pump as much data as Postgres can handle through Electric and sync it out to as many users as you can imagine. Electric scales and keeps sync latency flat and low.

#### High write throughput

Electric aims to be faster than Postgres. So you'll max out Postgres before you max out Electric. For example, Trigger.dev [sync 20,000 writes-per-second through Electric](https://trigger.dev/blog/how-we-built-realtime), with 500GB+ of Postgres inserts processed daily.

#### Massive read fan-out

We deliver data through existing CDN infrastructure. Our cloud benchmarks show Electric syncing an 80Gbps workload to a million concurrent clients with flat, low latency and memory use:

... chart ...

#### Sub-millisecond reactivity

In the client, because the TanStack DB query engine is based on differential dataflow, when the data changes, it incrementally updates just the relevant part of the result set. This keeps the live query latency sub-millisecond.

For example, here we see a benchmark across three extremely complex queries. They’re all running multiple joins across multiple tables with lots of rows using with grouping and aggregates, etc. As you can see, TanStack DB is sub-millisecond no matter what:

... video ...

Instead of your application grinding to a halt when you have lots of components running complex live queries, everything stays well within a single animation frame and your application goes brrr 🔥

### Declarative

abstracts state transfer out of application code

### Type-safe, reactive DX

...

### composable, extensible

...

works with your existing API

### incrementally adoptable

For example, if you have an existing API-based app using TanStack Query the steps are:

1. take your routes / loaders using TanStack Query and adjust them to load data into TanStack DB collections (using the same TanStack Query `queryFn`)
2. adjust your app code / components to read data from TanStack DB collections
3. add and swap out your query collections for sync-based collections using Electric

This gives you a practical migration pathway from existing API-based architecture to local-first sync.

## Next steps

[TanStack DB](https://tanstack.com/db) with [Electric](/) gives you real-time without the re-write and sync that just works. A new unified standard for sync and an optimal, end-to-end local-first sync stack.

It's the future of app development with Electric and hands down the best way of building the next generation of AI apps and agentic systems.

To get started, check out the two starters:

- [TanStack Start <> DB <> Electric starter](https://github.com/KyleAMathews/tanstack-start-db-electric-starter) for web aps
- [Expo <> DB <> Electric starter](https://github.com/KyleAMathews/expo-db-electric-starter) for mobile

Check out the project website at [tanstack.com/db](https://tanstack.com/db), the [official docs](https://tanstack.com/db/latest/docs/overview) and the [example app](https://github.com/TanStack/db/tree/main/examples/react/todo) in the [tanstack/db](https://github.com/tanstack/db) GitHub repo.

<figure style="background: none">
  <Tweet tweet-id="1947383819314823318" align="center" conversation="none" theme="dark" />
</figure>
