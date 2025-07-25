---
title: Local-first sync with TanStack DB
description: >-
  Tanstack DB is a reactive client store for building super fast apps on sync. Paired with Electric, it provides an optimal end-to-end sync stack for local-first app development.
excerpt: >-
  Tanstack DB is a reactive client store for building super fast apps on sync. Paired with Electric, it provides an optimal end-to-end sync stack for local-first app development.
authors: [thruflo]
image: /img/blog/local-first-sync-with-tanstack-db/header2.jpg
tags: [db]
outline: [2, 3]
post: true
---

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
</style>

[Tanstack DB](https://tanstack.com/db) is a reactive client store for building super fast apps on sync.

It's type-safe, declarative and incrementally adoptable. For real-time without the re-write and sync that just works.

> [!Warning] ✨&nbsp; TanStack DB starter
> ... info here about the starter with a link to the repo / docs ...

## The case for local-first sync

Front-end has long been about reactivity frameworks and client-side state management. However, the alpha in these is receding. The next frontier, with much bigger gains across UX, DX and AX lies in [local-first, sync engine architecture](#).

Sync-based apps like [Linear](#) and [Figma](#) feel instant to use and are naturally collaborative. Eliminating stale data, loading spinners and manual data wiring by design.

It's an ideal architecture for [building AI apps and agentic systems](#) and [makes LLM-generated code more maintainable](#) and production ready.

## Adding local-first sync to TanStack

[TanStack](https://tanstack.com) is a popular and fast growing collection of libraries for building modern apps.

It grew out of React Query, now [TanStack Query](https://tanstack.com/query), a library that gives you managed queries, caching, mutation primitives, etc.

### How TanStack Query works

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

So, we see that TanStack already handles data loading and local optimistic writes. What exactly do we need to add to TanStack for it to support local-first sync?

### Adding support for local-first sync

Local-first application code talks directly to a local store interface. This takes the [network off the interaction path](/use-cases/data-sync#replace-data-fetching-with-data-sync) and [abstracts data transfer and placement](/blog/2022/12/16/evolution-state-transfer#optimal-placement-and-movement-of-data) into the sync engine domain (where it can be automated, normalized and system optimized).

The first thing we need is a local store primitive to sync data in-and-out-of and for the app code to interact with. Let's call it a **Collection**.

<figure>
  <a class="no-visual" target="_blank"
      href="/img/blog/local-first-sync-with-tanstack-db/collection.lg.jpg">
    <img src="/img/blog/local-first-sync-with-tanstack-db/collection.png?v=2" />
  </a>
</figure>

Then for local reads, we need **Live&nbsp;Queries** that allow you to query and join data across collections. These need to be declarative, reactive and extremely efficient.

<figure>
  <a class="no-visual" target="_blank"
      href="/img/blog/local-first-sync-with-tanstack-db/live-queries.lg.jpg">
    <img src="/img/blog/local-first-sync-with-tanstack-db/live-queries.png" />
  </a>
</figure>

And for local writes, we need transactional **Optimistic Mutations** that can apply optimistic state across collections and tie its lifecycle in with the sync machinery.

<figure>
  <a class="no-visual" target="_blank"
      href="/img/blog/local-first-sync-with-tanstack-db/sync-on-sync-off.lg.jpg">
    <img src="/img/blog/local-first-sync-with-tanstack-db/sync-on-sync-off.png" />
  </a>
</figure>

If we have these three things:

1. collections with sync support
2. cross-collection live queries
3. optimistic mutations that tie into the sync machinery

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
- sync-aware optimistic mutations

It allows you to *incrementally* migrate existing API-based apps to local-first sync and build real-time apps that are resilient, reactive and, as we’ll see, insanely fast 🔥

<!--

For example, if you have an existing API-based app using TanStack Query the steps are:

1. take your routes / loaders using TanStack Query and adjust them to load data into TanStack DB collections (using the same TanStack Query `queryFn`)
2. adjust your app code / components to read data from TanStack DB collections
3. add and swap out your query collections for sync-based collections using Electric

This gives you a practical migration pathway from existing API-based architecture to local-first sync architecture.

-->

Let’s dive it and see how it works!

### Collections

Collections are typed sets of objects that can be populated with data. You can define many types of collections, including:

- fetching data, for example from API endpoints using TanStack Query
- syncing data, for example using Electric
- storing local data, for example using localStorage
- from live queries, creating derived collections as materialised views

For example, to define a TanStack Query collection:

```ts
```

We’ve seen this code before right? It fetches data using a managed `queryFn`. The API is deliberately the same, so the migration path from an existing TanStack Query app is minimal.

To define a sync collection using Electric, you provide `shapeOptions` to `electricCollectionOptions`:

```ts
```

If you’ve used it, these are exactly the same options you’d pass to the [Electric client](#) when defining a [Shape](#). (A shape is a filtered view on a database table. You can create as many views as you like with different subsets of the source data).

Once you have data in collections, you can bind it to your components using live queries.

### Live queries

... live queries are ...

You can query across as many collections as you like
They can be collections of different types.

Load some data from the database, some from an API; there’s a LocalCollection for UI state.
Query across them all as part of the same logical data model.
You can have as many complex queries as you like, with joins, aggregates, etc.

So, we’ve seen that the component code stays the same
but that queries are actually are super powerful under the hood.
=> The same is true of mutations

### OPTIMISTIC MUTATIONS

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

## Optimal end-to-end sync stack

When TanStack DB is paired with Electric, it gives you an end-to-end sync stack that's fast, scalable, declarative, type-safe, reactive, composable, extensible and incrementally adoptable.

### Insanely fast and scalable

There are two main aspects to performance of a sync stack:

1. client-side reactivity with live queries and re-rendering
2. server-side throughput and scalability of the sync engine

TanStack DB with Electric nails both: combining sub-millisecond reactivity with high data throughput and CDN-based data delivery.

#### Sub-millisecond client-side reactivity

Because the query engine is based on a Typescript implementation of
Differential dataflow
When the data changes, it incrementally updates just the relevant part of the result set.

=> three complex queries; they’re all running multiple joins across multiple tables with lots of rows using with grouping and aggregates, etc.

Basic JS is hacking it in JS
SQLite is re-running the query
TanStack DB
=> is sub-millisecond no matter what

Instead of your application grinding to a halt when you have lots of components; all running multiple complex live queries
Everything stays well within a single animation frame

#### High data throughput and CDN-based data delivery

Our goal for write-throughput (the volume of realtime data changes we can process) is to be faster than Postgres. So that if you have Electric processing data (filtering and fanning out changes) from Postgres, you'll max out Postgres before you max out Electric.

You can read about our work on this in our [scaling a sync engine](#) post and Trigger.dev's post about how they [sync 20,000 writes-per-second through Electric](#).

Then for read-path scalability, we deliver data through existing CDN infrastructure. This gives us effectively unlimited horizontal scalability (up-to the limits of the Cloudflare CDN). Our cloud benchmarks demonstrate scaling an 80gbps workload to a million concurrent clients with flat latency.

So pump as much data through as your database can handle and sync it to as many users as you can get, on a single Electric instance, without breaking a sweat.

### type-safe, reactive DX


### declarative

abstracts state transfer out of application code

### composable, extensible

### incrementally adoptable

### works with your existing API

 that's composable and incrementally adoptable.



Building apps on sync is one of the

TanStack is one of the most popular  for building modern web applications.

also "what electric sql is now"

S:

- simplified; pushed out of scope
- talking to users, see how they were creatively solving / working around limitations
- some cases we wrote up those patterns; like in the writes guide
- over time, we could see the desire paths we needed to pave over
- didn't want to just pave over, wanted to connect to the motorway

C:

- ...

Q:

- so where is the motorway, what is the mainstream of particularly SPA dev?

A:

- it's TanStack

tanstack is ...
what's missing ...


***

## ...

This is the future of application development with Electric. It unlocks realtime sync without the rewrite and it's the best way to build the next-generation of AI apps.

