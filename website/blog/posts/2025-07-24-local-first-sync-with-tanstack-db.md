---
title: Local-first sync with TanStack DB
description: >-
  Tanstack DB is a reactive client store for building super fast apps on sync. Paired with Electric, it provides an optimal end-to-end sync stack for local-first app development.
excerpt: >-
  Tanstack DB is a reactive client store for building super fast apps on sync. Paired with Electric, it provides an optimal end-to-end sync stack for local-first app development.
authors: [thruflo]
image: /img/blog/local-first-sync-with-tanstack-db/header.jpg
tags: [db]
outline: [2, 3]
post: true
---

[Tanstack DB](https://tanstack.com/db) is a reactive client store for building super fast apps on sync. Paired with [Electric](/) it provides an end-to-end sync stack for local-first app development.

The combination is insanely fast and scalable. With a declarative, reactive and type-safe programming model that's incrementally adoptable into existing apps. For real-time without the re-write and sync that just works.

> [!Warning] ✨&nbsp; TanStack DB starter
> ... info here about the starter with a link to the repo / docs ...

## Connecting the desire paths to the motorway

Last year, at Electric, we did a [clean re-write](#) of our core sync engine. Slimming down to focus on read-path sync with partial replication. This pushed concerns like client-side reactivity and local writes out-of-scope, so we could focus on making core Electric.

Having pushed these concerns back onto our users, it was fascinating to see how they creatively solved them. Over time, we started to see desire paths forming, with users:

- needing a reactive client side store to sync into and code against
- home-rolling solutions to manage local optimistic state and write-path sync

In some cases, we wrote solutions up as patterns, like in the [writes guide](#). In other cases, we pointed to integrations like [LiveStore](#) and [Phoenix.Sync](#).

What became increasingly clear was that **these were the desire paths that we needed to pave over**. But, of course, at Electric, we're focused on mainstreaming sync and local-first. We want to build an on-ramp for mainstream adoption into both greenfield and brownfield applications.

So, we didn't want to just pave over these desire paths. We wanted to plug them into the mainstream. So, where is that? What is the stack or framework that teams with good taste are choosing to build their startups on?

The answer, of course, is [TanStack](https://tanstack.com).

## Adding local-first sync to TanStack

TanStack is a collection of TypeScript libraries for building modern apps.

It grew out of React Query, now [TanStack Query](https://tanstack.com/query). A library that gives you managed queries, caching, mutation primitives, etc. It now has other popular libraries like [TanStack Router](https://tanstack.com/router), [TanStack Start](https://tanstack.com/start), etc.

This is TanStack Query code:

```tsx
```

It loads data into a React state variable. Using a managed `queryFn`. So the query function defines how you fetch the data and TanStack Query then manages calling it, retries, caching, etc.

Then when it comes to writes, you create a mutator with a `mutationFn` that defines how you actually handle the write. In this case by posting it to your API:

```tsx
```

You can then use this mutator in your components to make local optimistic writes:

```tsx
```

So, what exactly do we need to do or add to this to pave over our desire paths and integrate local-first sync into TanStack?

Well, the first thing is that we need to change from *fetching* data (using the managed query primitive) to *syncing* data into a local store. That means we need a primitive to sync into. Which we'll call a `Collection`.

... collection diagramme ...

We then need the local mutations to apply optimistic state to collections and to tie the optimistic state lifecycle in with the sync machinery.

... diagramme ...

Lastly, we need to provide a declarative, reactive programming model for working with the data in collections. Which means adding cross-collection live queries.

If we have these three things:

1. collections with sync support
2. cross-collection live queries
3. optimistic mutations that tie into the sync machinery

Then we have a local-first sync stack built natively into TanStack.

## Introducing TanStack DB

TanStack DB is a reactive client side store, built into TanStack, that extends TanStack Query with collections, live queries and sync-aware optimistic mutations.

It allows you to *incrementally* migrate existing API-based apps to local-first sync. Resulting in apps that are resilient, reactive and, as we’ll see, insanely fast 🔥

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

