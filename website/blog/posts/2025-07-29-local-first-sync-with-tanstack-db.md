---
title: Local-first sync with Electric and TanStack DB
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
tags: [db, tanstack-db, postgres-sync]
outline: [2, 3]
post: true
---

<script setup>
import Tweet from 'vue-tweet'
import ScalabilityChart from '../../src/components/ScalabilityChart.vue'
</script>

<style scoped>
  figure, video {
    background: #161618;
    border-radius: 14px;
    margin: 28px 0;
  }
  figure#tanstack-db-image {
    margin: -40px 0;
  }
  video {
    aspect-ratio: 139/90;
    overflow: hidden;
  }
  h2#introducing-tanstack-db {
    border: none;
  }
  .embed-container {
    margin: 28px 0;
  }
</style>

<div class="hidden-xs">

[Tanstack DB](https://tanstack.com/db) is a [reactive client store for building super fast apps on sync](https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query). Paired with [Electric](/), it provides an optimal end-to-end sync stack for building <span class="no-wrap-sm">[local-first apps](/sync)</span>.

</div>
<div class="block-xs">

[Tanstack DB](https://tanstack.com/db) is a reactive client store for [building super fast apps on&nbsp;sync](https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query).

Paired with [Electric](/), it provides an optimal end-to-end sync stack for [local-first app&nbsp;development](/sync).

</div>

Type-safe, declarative, incrementally adoptable and insanely fast, it's the future of app development with Electric and the best way of [building AI apps<span class="hidden-xs"> and agentic systems</span>](/blog/2025/04/09/building-ai-apps-on-sync).

> [!Warning] ✨&nbsp; TanStack&nbsp;DB <> Electric&nbsp;starters
> Fire up TanStack DB with Electric using the [TanStack&nbsp;Start&nbsp;starter](https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-web-starter) and [Expo&nbsp;starter](https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-expo-starter) templates.
>
> Docs are at [tanstack.com/db](https://tanstack.com/db) and there's an [example&nbsp;app](https://github.com/TanStack/db/tree/main/examples/react/todo) in&nbsp;the&nbsp;repo.

> [!Info] ⚡&nbsp; Interactive guide to TanStack DB
> [What TanStack DB is](https://frontendatscale.com/blog/tanstack-db) how it works and why it might change the way you build apps.

## The next frontier for front&#8209;end

Front-end has long been about reactivity frameworks and client-side state management. However, the alpha in these is receding. The next frontier, with much bigger gains<span class="inline-md">,</span> <span class="hidden-md">across UX, DX and AX</span> lies in [local-first<span class="hidden-md">,</span> sync<span class="hidden-md"> engine architecture</span>](/sync).

Sync-based apps like [Linear](https://linear.app/blog/scaling-the-linear-sync-engine) and [Figma](https://www.figma.com/blog/how-figmas-multiplayer-technology-works) are instant to use and naturally collaborative. Eliminating stale data, loading spinners and manual data&nbsp;wiring.

It's the best way to keep [users and agents in sync](/blog/2025/04/09/building-ai-apps-on-sync) when building AI apps and agentic systems and it's the best way to keep [LLM&#8209;code&nbsp;maintainable](/blog/2025/04/22/untangling-llm-spaghetti).

## Adding local-first sync to TanStack

[TanStack](https://tanstack.com) is a collection of TypeScript libraries for building web and mobile apps.

Developed by an open collective, stewarded by [Tanner Linsley](https://github.com/tannerlinsley), it's one of the best and most popular ways to build modern apps.

Tanner has long wanted to add local-first sync to TanStack: <em>&ldquo;I think ideally every developer would love to be able to interact with their APIs as if they were local-first. I have no doubt that that is what everybody wants.&rdquo;</em>.

<div class="embed-container">
  <YoutubeEmbed video-id="hy9pNJMFfyM" />
</div>

When Electric co-founder [Kyle Mathews](/about/team#kyle) approached Tanner to work on this, they immediately aligned on DX and a vision for incrementally adoptable local-first app development. There was still once piece missing though: a reactive query engine fast enough to make the vision a reality.

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
    queryKey: ['todos'],
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
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: ['todos'],
      }),
  })

  // continues below ...
}
```

You can then use this mutation in your components to make instant local writes, with TanStack Query managing the [optimistic state lifecycle](https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates) for you:

```tsx
function Todos() {
  // ... as above

  const addTodo = () => mutate({ title: 'Some Title' })

  return <Button onClick={addTodo} />
}
```

### Adding support for local-first sync

So, we see that TanStack already handles data loading and local optimistic writes. What exactly do we need to add to TanStack for it to support local-first sync?

Well, local-first application code talks directly to a local store interface. This takes the [network off the interaction path](/sync#replace-data-fetching-with-data-sync) and [abstracts data transfer and placement](/blog/2022/12/16/evolution-state-transfer#optimal-placement-and-movement-of-data) out of the app code (into the sync engine where it can be system optimized).

So, the first thing we need is a local store primitive to sync data into that the app code can talk to. Let's call it a **Collection**.

<figure>
  <a class="no-visual" target="_blank"
      href="/img/blog/local-first-sync-with-tanstack-db/collection.lg.jpg">
    <img src="/img/blog/local-first-sync-with-tanstack-db/collection.png?v=2" />
  </a>
</figure>

Once we have data in collections, we need **Live Queries** to read it and react when it changes.

<figure>
  <a class="no-visual" target="_blank"
      href="/img/blog/local-first-sync-with-tanstack-db/live-queries.lg.jpg">
    <img src="/img/blog/local-first-sync-with-tanstack-db/live-queries.png" />
  </a>
</figure>

Then for local writes, we need **Optimistic Mutations** that apply optimistic state to collections and tie the optimistic state lifecycle in with the sync machinery.

<figure>
  <a class="no-visual" target="_blank"
      href="/img/blog/local-first-sync-with-tanstack-db/sync-on-sync-off.lg.jpg">
    <img src="/img/blog/local-first-sync-with-tanstack-db/sync-on-sync-off.png" />
  </a>
</figure>

If we have these three things &mdash; collections, live queries and mutations that tie into the sync machinery &mdash; then we have a local-first sync stack built natively into TanStack.

<h2>&nbsp;</h2>

<figure id="tanstack-db-image">
  <a class="no-visual" target="_blank"
      href="https://tanstack.com/db">
    <img src="/img/blog/local-first-sync-with-tanstack-db/tanstack-db.sm.jpg"
        class="block-sm"
    />
    <img src="/img/blog/local-first-sync-with-tanstack-db/tanstack-db.jpg"
        class="hidden-sm"
    />
  </a>
</figure>

## Introducing TanStack DB

[TanStack DB](https://tanstack.com/db) is a reactive client store that extends TanStack Query with:

- [collections](#collections)
- [live queries](#live-queries)
- [transactional mutations](#transactional-mutations)

It allows you to _incrementally_ migrate existing API-based apps to local-first sync and build real-time apps that are resilient, reactive and, as we’ll see, insanely fast 🔥

Let’s dive it and see how it works!

### Collections

Collections are typed sets of objects that can be populated with data.

You can populate data in many ways, such as fetching data from API endpoints using TanStack Query and syncing data using sync engines like Electric and Materialize. You can also store local client data and derive collections from live queries.

#### Query collections

Query collections fetch data using [TanStack Query](https://tanstack.com/query/latest).

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
    queryClient,
  })
)
```

We’ve seen the heart of this before, right? It fetches data using a managed `queryFn`. You can then configure polling or call `invalidate()` on the TanStack `queryClient` to fetch fresh data into the collection:

```ts
queryClient.invalidateQueries({
  queryKey: ['todos'],
})
```

This allows you to take existing API-based applications and incrementally layer on TanStack DB where you need it, with minimal changes to your code.

It also allows you to load data into your app from a variety of sources: anything that provides or can be wrapped by an API. That can be your backend API but can also be an external service, like an auth service or a weather API.

#### Sync collections

Sync collections automatically and efficiently keep the data in the collection up-to-date. You don't need to tell a sync-based collection to re-fetch data. It always keeps the local data live and up-to-date in real-time for you.

There are already a number of TanStack DB collections for different sync engines built-in or under development, including [Electric](/), [Firebase](https://firebase.google.com/), [Materialize](https://materialize.com) and [Trailbase](https://trailbase.io).

Electric is our open-source, Postgres-native, super fast sync engine. To create a collection that syncs data using Electric, you use the same options that you’d pass to the [Electric client](/docs/api/clients/typescript) when defining a [Shape](/docs/guides/shapes). A shape is a [filtered view on a database table](/docs/guides/shapes#where-clause) that Electric syncs out-of Postgres, into the client for you:

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
      },
    },
    getKey: (item) => item.id,
    schema: todoSchema,
  })
)
```

This keeps the collection in sync with the `todos` table in your Postgres database.

You can create as many filtered views as you like on the same table. For example, syncing just your todos created this year:

```ts
const myRecentTodoCollection = createCollection(
  electricCollectionOptions({
    id: 'sync-my-recent-todos',
    shapeOptions: {
      url: 'http://localhost:3003/v1/shape',
      params: {
        table: 'todos',
        where: `
          user_id = '${currentUser.id}'
          AND
          inserted_at >= '2025-01-01'
        `,
      },
    },
    getKey: (item) => item.id,
    schema: todoSchema,
  })
)
```

#### Other collections

There are a range of other collections also built into TanStack DB. Such as an ephemoral [local collection](https://github.com/TanStack/db/blob/main/packages/db/src/local-only.ts) and a persistent [localStorage collection](https://github.com/TanStack/db/blob/main/packages/db/src/local-storage.ts). You can also create your own collections by following the [collection options creator guide](https://tanstack.com/db/latest/docs/collection-options-creator).

Once you have your data in collections, you can access it using live queries.

### Live queries

[Live queries](https://tanstack.com/db/latest/docs/live-queries) run reactively against and across collections. They're fast and expressive, with support for [joins](https://tanstack.com/db/latest/docs/live-queries#joins), [filters](https://tanstack.com/db/latest/docs/live-queries#where-clauses) and [aggregates](https://tanstack.com/db/latest/docs/live-queries#groupby-and-aggregations).

There's a number of ways to build and use them. The most common is using a framework hook in your components like `useLiveQuery` for React:

```tsx
import { useLiveQuery, eq } from '@tanstack/react-db'

const Todos = () => {
  const { data } = useLiveQuery((query) =>
    query
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.completed, true))
  )

  return <List items={data} />
}
```

This keeps the value of the `data` state variable in sync with the contents of your collection. There's no manual data wiring and your component code doesn't know, or care, where the data in the collection came from.

Data fetching is entirely abstracted out of the component code.

#### Querying across collections

You can use live queries to query across multiple collections.

They can be collections of the same type or different types. So you can use the collection primitive to load/sync/save data from different sources and then use live queries to query across them as part of the same logical data model.

```tsx
// Fetch authenticated users from an external auth service.
const authCollection = createCollection(queryCollectionOptions(...))

// Store ephemoral notes as local client state
const notesCollection = createCollection(localOnlyCollectionOptions(...))

// Sync todos data from the database.
const todoCollection = createCollection(electricCollectionOptions(...))

function Todos() {
  const { data } = useLiveQuery((query) =>
    query
      .from({ todo: todoCollection })
      .join({ user: authCollection }, ({ todo, user }) => eq(todo.userId, user.id))
      .join({ note: noteCollection }, ({ note, todo }) => eq(note.todoId, todo.id))
      .select(({ note, todo, user  }) => ({
        id: todo.id,
        numNotes: count(note.id),
        owner: user.name
      }))
  )

  return <List items={ data } />
}
```

#### Sub-millisecond performance

The live query engine is based on [a Typescript implementation of differential dataflow](https://github.com/electric-sql/d2ts). This means that, when the data changes, it incrementally updates just the relevant part of the result set. This keeps the live query latency blazing fast 🔥

Because the engine is so fast, you can have as many [complex queries and joins](https://tanstack.com/db/latest/docs/live-queries#table-of-contents) as you like, across lots of components and collections.

For example, here we see a benchmark across three extremely complex queries. They’re all running multiple joins across multiple tables with lots of rows using with grouping and aggregates, etc. As you can see, TanStack DB queries are all sub-millisecond no matter what:

<video class="w-full" controls poster="/videos/blog/local-first-sync-with-tanstack-db/tanstack-db-speed-3.jpg">
  <source src="/videos/blog/local-first-sync-with-tanstack-db/tanstack-db-speed-3.mp4" />
</video>

Instead of your application grinding to a halt when you have lots of components running complex live queries, everything stays well within a single animation frame and your application feels super fast and responsive to use.

#### Collections all the way down

Just as you can create live queries from collections, you can also create collections from live queries. This allows you to create new collections as materialised views derived from your synced or loaded data:

```ts
import {
  createCollection,
  liveQueryCollectionOptions,
  eq,
} from '@tanstack/react-db'

const pendingTodos = createCollection(
  liveQueryCollectionOptions({
    query: (query) =>
      query
        .from({ todo: todoCollection })
        .where(({ todo }) => eq(todo.completed, false)),
  })
)
```

You can also access live query results as collections in your components:

```ts
function Todos() {
  const { collection: pendingTodos } = useLiveQuery((query) =>
    .from({ todo: todoCollection })
    .where(({ todo }) => eq(todo.completed, false))
  )
```

And then join across and query these derived collections. This allows you to compose a pipeline of layered queries, materializing as a collection when you want to cache a layer of the pipeline.

For example, this code creates a filtered `todoResults` collection and then additionally filters the results again against a typeahead `filterText` value. This avoids re-computing the whole pipeline when the typeahead filter text changes.

```tsx
const { collection: todoResults } = useLiveQuery(
  (query) => (
    query // First filter the todos by listId.
      .from({ todo: todoCollection })
      .where(({ todo }) => eq(todo.listId, listId))
  ),
  [listId]
)

const { data: todos } = useLiveQuery(
  (query) => {
    query // Then filter by the typeahead filter text.
      .from({ result: todoResults })
      .where(({ result }) => ilike(result.title, `%${filterText}%`)
  },
  [filterText]
)
```

Collections and live queries are [composable](https://tanstack.com/db/latest/docs/live-queries#composable-queries). It's <strike>turtles</strike> collections (and efficient, incremental computation) all the way down.

### Transaction mutations

[Transactional mutations](https://tanstack.com/db/latest/docs/overview#making-optimistic-mutations) apply local optimistic writes transactionally across collections.

Like with TanStack Query, mutations manage optimistic state for you. So the write is displayed immediately and then sent/synced to the server in the background. What's different is that TanStack DB mutations:

- **are transactional** so they're applied, handled and can be rolled-back atomically across collections; and it
- **tie the optimistic state lifecycle in with the sync machinery** so that the optimistic state can be discarded when local transactions sync back into the app

#### Collection operations

The simplest way to make local writes is to call `insert`, `update` and `delete` operations directly on a collection. They default to triggering the corresponding `onInsert`, `onUpdate` and `onDelete` handler defined in your collection config:

```tsx
const todoCollection = createCollection({
  // ... other config options as above

  // Define an update handler to send changes to your API
  onUpdate: async ({ transaction }) => {
    const { original, changes } = transaction.mutations[0]

    await api.post(`/todos/${original.id}`, changes)
  },
})

// Then in your components you can call `collection.update()`
function Todo({ todo }) {
  const completeTodo = todoCollection.update(todo.id, (draft) => {
    draft.completed = true
  })

  return <Button onClick={completeTodo} />
}
```

In this, the update handler is equivalent to the TanStack Query `mutationFn`. With a key difference being that its passed a `transaction` rather than a mutated object.

#### Optimistic state management

Internally, each collection stores synced data and optimistic state seperately and rebases the optimistic state on top of the synced data. The `todoCollection.update` call in the component adds the write to the optimistic state. This causes the collection data and live queries to show the write instantly. It then invokes the `onUpdate` handler, which is responsible for actually sending the mutation to the backend.

If the write is rejected, the local optimistic state is rolled back. If the write succeeds then the optimistic state is discarded when your handler resolves. This allows you to control when to discard it. For example, with a query collection you can make the write, refetch to update the collection data and then return once the collection has been updated:

```tsx
const todoCollection = createCollection(queryCollectionOptions({
  // ... other config options

  onUpdate: async ({ transaction }) => {
    const { original, changes, collection } = transaction.mutations[0]

    await api.post(`/todos/${original.id}`, changes)
    await collection.refetch()
  }
})
```

#### Transactions and optimistic actions

For cases where direct collection operations are too simplistic, you can create custom actions or transactions with `createOptimisticAction` and `createTransaction`.

```tsx
import { createOptimisticAction } from '@tanstack/react-db'

const createUserWithDefaultWorkspace = createOptimisticAction({
  (loginName) => {
    const userId = crypto.randomUUID()
    const workspaceId = crypto.randomUUID()

    // These inserts are applied atomically
    userCollection.insert({
      id: userId,
      name: loginName
    })
    workspaceCollection.insert({
      id: workspaceId,
      name: 'Default'
    })
    membershipCollection.insert({
      role: 'owner',
      userId,
      workspaceId
    })
  },
  mutationFn: async (_loginName, { transaction }) => {
    // In this case, the `transaction` contains all three mutations.

    // ... handle sending to the server ...
  }
})
```

Then in your component the usage is simple:

```tsx
function SignUp() {
  const handleClick = () => {
    createUserWithDefaultWorkspace('thruflo')
  }

  return <Button onClick={handleClick} />
}
```

This lets you transactionally apply writes across multiple collections (as well as building other advanced write semantics, like chaining transactions with intermediate rollbacks). While keeping code clean and concerns seperated.

#### API-based writes

In the example above, the `mutationFn` handler receives a transaction with three mutations, each made to a different collection. For existing API-based apps, the simplest way to handle these may be to POST each write to an individual API endpoint, e.g.:

- `POST {id, name} /api/users`
- `POST {id, name} /api/workspaces`
- `POST {role, userId, workspaceId} /api/memberships`

Or you may choose to POST all of the data to a custom endpoint, designed to perform the correct operations transactionally on the server:

- `POST {user, workspace, membership} /api/create-user-with-default-workspace`

How you handle writes is entirely up-to-you. Mutation handlers are designed to be flexible and allow you to easily send writes to an existing backend API.

#### Write-path sync

Write-path sync is a pattern where all writes made to the local database are automatically synced to a server database via a generic ingest endpoint. If you choose, you can implement write-path sync with TanStack DB using a generic ingest endpoint and `mutationFn`.

For example, when using TanStack DB with Electric, you can use the Electric collection `awaitTxId` utility to sync the changes to the server, monitor the replication stream and discard the optimistic state when the write syncs back into the app:

```ts
export const mutationFn = async (_variables, { transaction }) => {
  const mutations = transaction.mutations

  const collections = new Set(mutations.map((mutation) => mutation.collection))
  const payloadData = mutations.map((mutation) => {
    const { collection, ...result } = mutation

    return result
  })

  // Post the mutations data to the ingest endpoint.
  const txid = await api.post('/ingest', { mutations: payloadData })

  // Monitor the collections for the transaction to sync back in.
  const promises = [...collections].map(({ utils }) => utils.awaitTxId(txid))
  await Promise.all(promises)
}
```

::: details A note on merge semantics

TanStack DB supports rollbacks. This keeps things simple by allowing local writes to be validated (and if necessary rejected) by a central server.

Because writes go through your API, into your database, you can also easily implement more advanced concurrency semantics if you need to. Such as writing into conflict-free datatypes.

It's also worth noting that, in the example above, matching on transaction ID (rather than, say, row ID) allows the local optimistic state to be rebased over concurrent writes from other users.

:::

Then on the server side you can just … ingest the changes. In any language or framework you like: this works with [your API, your stack](/blog/2024/11/21/local-first-with-your-existing-api).

One reference implementation is the [Phoenix.Sync](https://hexdocs.pm/phoenix_sync) library, which adds sync support to the Elixir [Phoenix web framework](https://www.phoenixframework.org/). This provides a [`Writer`](https://hexdocs.pm/phoenix_sync/Phoenix.Sync.Writer.html) module that can be used to save changes into Postgres through a declarative ingest pipeline:

```elixir
defmodule IngestController do
  use Phoenix.Controller, formats: [:json]
  alias Phoenix.Sync.Writer

  def mutate(conn, %{"mutations" => mutations} = _params) do
    {:ok, txid, _changes} =
      Writer.new()
      |> Writer.allow(Accounts.User)
      |> Writer.allow(Workspaces.Workspace)
      |> Writer.allow(Workspaces.Membership)
      |> Writer.ingest(mutations, format: Writer.Formats.TanstackDB)
      |> Writer.transaction(Repo)

    json(conn, %{txid: txid})
  end
end
```

The key thing is for your write / ingest endpoint on the server to return the [Postgres transaction ID](https://www.postgresql.org/docs/current/transaction-id.html) that the changes are written under. This allows TanStack DB to tie the optimistic state lifecycle in with the sync machinery (using the `awaitTxId` utility).

## Optimal sync stack

When TanStack DB is paired with Electric, it gives you an optimal, end-to-end local-first sync stack. The combination is super fast, scalable, declarative, type-safe, reactive, composable, extensible and incrementally adoptable.

### Super fast and scalable

As we've seen, TanStack DB query engine is [based on differential dataflow](https://github.com/electric-sql/d2ts), when the data changes, it incrementally updates just the relevant part of the result set and the reactivity is sub-millisecond.

For data delivery and fan-out, Electric serves data through existing CDN infrastructure. This handles millions of concurrent users out of the box. For example, our [cloud benchmarks](/docs/reference/benchmarks#cloud) show Electric syncing an 80Gbps workload to a million concurrent clients with flat, low latency and memory use:

<figure>
  <ScalabilityChart />
</figure>

For write-throughout, Electric aims to be faster than Postgres. So you'll max out Postgres before you max out Electric. For example, Trigger.dev [sync 20,000 writes-per-second through Electric](https://trigger.dev/blog/how-we-built-realtime), with 500GB+ of Postgres inserts processed daily.

The combination is an end-to-end stack that's live, reactive, super fast and scalable.

### Declarative and type-safe

TanStack DB [abstracts data transfer and placement](/blog/2022/12/16/evolution-state-transfer) out of your application code and supports fully type safe development.

Abstracting state transfer out of your app code allows it to be normalized and system optimised. This speeds up data loading, simplifies your codebase and avoids LLM-generated code [imperatively fetching data](/blog/2025/04/22/untangling-llm-spaghetti). App code and components just don't need to know how or where the data came from.

For type-safety, collections support passing in any [Standard Schema](https://standardschema.dev/) instance, such as an Effect or Zod schema. Collection methods, live queries and mutations are all fully typed. In many cases, you can re-use or generate this schema from your [existing ORM, schema definition or backend code](https://standardschema.dev/#what-schema-libraries-implement-the-spec).

### Composable, extensible and incrementally adoptable

TanStack DB allows you to load data from different sources, including existing API and external services and handle writes with your existing API. It has framework adapters for [common reactivity frameworks](https://tanstack.com/db/latest/docs/framework) and allows you to incrementally adopt sync one fetch, one route, one component at a time.

Electric syncs data through [standard HTTP and JSON](/docs/api/http) and works [with your existing API](/blog/2024/11/21/local-first-with-your-existing-api). The combination is designed to provide a practical pathway to incrementally adopting real-time sync, without needing to re-write your code.

For example, to migrate an existing API-based app using TanStack Query:

1. take an existing route / loader
2. adjust is to load data into a query collection (using the same `queryFn`)
3. adjust your components to read data from that collection using live queries
4. adjust your writes to use TanStack DB mutations (using the same `mutationFn`)
5. adjust your collection config from query to sync using Electric

Each step will make your app faster and more resilient, as well as providing a practical migration pathway from data-fetching to real-time, local-first sync.

## Next steps

[TanStack DB](https://tanstack.com/db) with [Electric](/) provides a pathway to real-time without the re-write and an optimal, end-to-end local-first sync stack that just&nbsp;works.

To get started, check out the [TanStack&nbsp;Start&nbsp;starter](https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-web-starter) for web and [Expo&nbsp;starter](https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-expo-starter) for&nbsp;mobile.

See the [TanStack blog post](https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query), the project website at [tanstack.com/db](https://tanstack.com/db), the [official docs](https://tanstack.com/db/latest/docs/overview) and the [example&nbsp;app](https://github.com/TanStack/db/tree/main/examples/react/todo) in the [tanstack/db](https://github.com/tanstack/db) GitHub&nbsp;repo.

<div class="actions cta-actions page-footer-actions left">
  <div class="action cloud-cta">
    <VPButton
      href="https://github.com/electric-sql/electric/tree/main/examples/tanstack-db-web-starter"
      text="Starter"
      theme="brand"
    />
    &nbsp;
    <VPButton
        href="https://tanstack.com/blog/tanstack-db-0.1-the-embedded-client-database-for-tanstack-query"
        text="Blog"
        theme="alt"
    />
    &nbsp;
    <VPButton
        href="https://tanstack.com/db/latest/docs/overview"
        text="Docs"
        theme="alt"
    />
    &nbsp;
    <VPButton
        href="https://github.com/TanStack/db"
        text="Repo"
        theme="alt"
    />
  </div>
</div>

<figure style="background: none">
  <Tweet tweet-id="1947383819314823318" conversation="none" theme="dark" />
</figure>
<figure style="background: none">
  <Tweet tweet-id="1950262878852043103" conversation="none" theme="dark" />
</figure>
