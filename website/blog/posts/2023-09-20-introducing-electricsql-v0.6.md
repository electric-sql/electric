---
title: Local-first sync for Postgres from the inventors of CRDTs
description: >-
  Introducing the v0.6 release of ElectricSQL. A local-first sync layer that you can use to build reactive, realtime, offline-capable apps directly on Postgres with your existing data model.
authors: [thruflo, balegas]
image: /img/blog/introducing-electric-sql/image.jpg
tags: [release]
outline: deep
post: true
---

Introducing the v0.6 release of ElectricSQL. A local-first sync layer that you can use to build reactive, realtime, offline-capable apps directly on Postgres.

<!--truncate-->

> [!WARNING]
> This post describes a release of an old version of Electric that's no longer active. See the [Electric Next](/blog/2024/07/17/electric-next) post for context.

## Introducing ElectricSQL v0.6

We've been working hard for the last six months to build [a new version of ElectricSQL](https://legacy.electric-sql.com/docs). One that's [Postgres-centric](https://legacy.electric-sql.com/docs/usage/data-modelling), with a [shape-based sync](https://legacy.electric-sql.com/docs/usage/data-access/shapes) model and type-safe [data access library](https://legacy.electric-sql.com/docs/usage/data-access/client).

Huge credit goes to our founding engineers ([@alco](https://github.com/alco), [@icehaunter](https://github.com/icehaunter), [@kevin-dp](https://github.com/kevin-dp), [@magnetised](https://github.com/magnetised), [@paulharter](https://github.com/paulharter) and [@samwillis](https://github.com/samwillis)) alumni ([@dch](https://github.com/dch), [@defnull](https://github.com/defnull)) advisors ([@bieniusa](https://github.com/bieniusa), [Marc Shapiro](https://lip6.fr/Marc.Shapiro/), [Nuno Preguiça](https://asc.di.fct.unl.pt/~nmp/) and [@josevalim](https://github.com/josevalim)) and to [everyone in the community](/about/community) who's helped contribute, share ideas and feedback and supported us whilst we got this done.

Since we shipped our [first developer preview](https://www.npmjs.com/package/electric-sql/v/0.1.0) back in October 2022, interest in [local-first software](https://lofi.software) has been taking off. Developers intuitively see the benefits around data ownership and UX. Teams behind apps like [Muse](https://www.youtube.com/watch?v=WEFuEY3fHd0), [Linear](https://www.youtube.com/watch?v=Wo2m3jaJixU) and [Facebook Messenger](https://engineering.fb.com/2020/03/02/data-infrastructure/messenger/) are increasingly highlighting the benefits around developer experience and operational simplicity.

Projects like the [Riffle and Overtone collaboration](https://www.youtube.com/watch?v=zjl7CpG9h3w) and [Cambria](https://www.inkandswitch.com/cambria/) have dived deep into the challenges of reactivity, performance and schema evolution. App and framework builders both articulate the need for a sync layer that supports dynamic partial replication.

Right now, [local-first systems](/docs/reference/alternatives) are also all greenfield. They don't integrate with your existing data model or backend systems. They expect you to start from scratch or build your own bridges. And they still bubble complexity up into the application domain.

For local-first to go mainstream, it can't all be greenfield. There needs to be an adoption pathway for existing systems. You need to be able to drop local-first onto your existing data model, like you can do with [REST](https://postgrest.org) and [GraphQL](https://hasura.io).

And this needs to actually work. Which means it syncs the right data and handles all the [concurrency stuff](/docs/reference/literature) without leaking complexity into your app.

## Electric - Sync for modern apps

So that's what we decided to build. A local-first sync layer that works with your existing data model and solves dynamic partial replication. That supports real world schema evolution and provides expressive, type-safe sync and data-access APIs.

To be honest, we also really wanted to [build on our research](/docs/reference/literature) on [preserving invariants in an AP database system](/blog/2022/05/03/introducing-rich-crdts) to do real SQL with integrity in a local-first setting (see [example](https://legacy.electric-sql.com/docs/intro/offline#preserving-data-integrity)). Plus we wanted to build a system that's open source and designed for self-host, so it's easy to adopt without the lock-in you get from proprietary and hosted services.

We're still early stage but [the code is live and the system works](/docs/quickstart). You can use it today to build reactive, realtime, local-first apps. Using standard Postgres and SQLite.

### Reactive, realtime, local-first apps

By sync layer, we mean [bi-directional active-active replication](https://legacy.electric-sql.com/docs/intro/active-active) with [transactional causal+ consistency](https://legacy.electric-sql.com/docs/reference/consistency) between Postgres in the cloud (usually!) and SQLite on the local-device.

Apps read and write data directly from and to a local embedded SQLite database. Writes immediately trigger reactivity, so data is visible and components re-render instantly. Data then syncs in the background through Postgres, in realtime, between users and devices.

As a result, apps built with Electric [feel instant to use](https://legacy.electric-sql.com/docs/intro/local-first), naturally support [realtime multi-user collaboration](https://legacy.electric-sql.com/docs/intro/multi-user) and default to [working offline](https://legacy.electric-sql.com/docs/intro/offline). Because it's a [conflict-free and rollback-free system](https://legacy.electric-sql.com/docs/reference/consistency), apps naturally also handle concurrency and overlapping writes.

### Open source, self-host

The code is [Apache 2.0 licensed](https://github.com/electric-sql/electric/blob/main/LICENSE). The server-side component is a horizontally scalable [Elixir web service](https://legacy.electric-sql.com/docs/usage/installation/service) with no complex durability requirements. There are instructions to run yourself using [Docker](https://legacy.electric-sql.com/docs/deployment/docker), [Fly](https://legacy.electric-sql.com/docs/deployment/fly), [Kubernetes](https://legacy.electric-sql.com/docs/deployment/k8s), etc.

## Directly on Postgres

Electric is built on [standard open-source Postgres](https://legacy.electric-sql.com/docs/usage/installation/postgres). Postgres is the central database, the source of durability and the control plane for managing the propagation of data (DML) and the database schema (DDL) to your local-first apps. This schema is then used to generate a type-safe database client with support for relational invariants.

### Hasura for local first

Electric is designed to work with *existing Postgres data models*. This means it works for both greenfield and brownfield applications. The aim is to be able to drop Electric onto Postgres for instant local-first, in the same way you can drop [Hasura](https://hasura.io/) or [PostgREST](https://postgrest.org) on for instant GraphQL or REST APIs.

:::info
In fact, one way of understanding ElectricSQL is "GraphQL in SQL". Because why would you need an additional declarative query language to [manage state transfer](/blog/2022/12/16/evolution-state-transfer) when you're already using SQL in a Postgres-backed system?
:::

### Postgres-centric migrations

Electric replicates data into and out of Postgres using standard built-in logical replication. This allows Postgres to be used as the source of both the [DDL schema for the local-apps](https://legacy.electric-sql.com/docs/usage/data-modelling/migrations) and the [DDLX rules](https://legacy.electric-sql.com/docs/api/ddlx) that authorise data access:

```sql
-- Define and evolve your DDL schema as normal.
CREATE TABLE projects (
  id UUID PRIMARY KEY
  owner_id UUID REFERENCES(users.id)
);

-- Explicitly opt tables in to the Electric replication machinery.
ALTER TABLE projects
  ENABLE ELECTRIC;

-- Annotate your model with Electric-scoped DDLX rules.
ELECTRIC ASSIGN 'projects:owner'
  TO projects.owner_id;

ELECTRIC GRANT ALL ON projects
  TO 'projects:owner';
```

:::info
ElectricSQL uses event triggers to propagate DDL changes over logical replication.

In fact, by marking the DDL schema as a causal dependency of the writes that use it, we're able to guarantee consistent distributed schema evolution just using the [core consistency guarantees](https://legacy.electric-sql.com/docs/reference/consistency) of the replication protocol.
:::

### Standard relational invariants

One of the key design goals for ElectricSQL is to deliver real SQL support. We're still in early stages of development. So right now, for example, invariant support is limited to [referential integrity using compensations](https://legacy.electric-sql.com/docs/reference/consistency#rich-crdts). However, our aim is to support:

- all built-in Postgres data types, most common extension data types and an extension mechanism to support arbitrary data types
- all relational invariants, including referential integrity, referential integrity across replication boundaries, unique constraints and check constraints

In this we're building on [research we authored](/docs/reference/literature) and are [implementing as Rich-CRDTs](/blog/2022/05/03/introducing-rich-crdts).

### Type-safe, auto-generated client

Electric auto-generates a type-safe database client from the [electrified sub-set](https://legacy.electric-sql.com/docs/usage/data-modelling/electrification) of your Postgres schema. Run a [generator script](https://legacy.electric-sql.com/docs/api/cli#generate) as part of your build process:

```shell
npx electric-sql generate [--watch]
```

And import a [type-safe, schema-aware client library](https://legacy.electric-sql.com/docs/usage/data-access/client) into your app:

```tsx
import { schema, Project } from './generated/client'

const { db } = await electrify(conn, schema, config)
const projects: Project[] = db.projects.findMany({
  where: {
    owner_id: auth.user_id
  }
})
```


## Dynamic partial replication

Which takes us to the heart of the system: [a type-safe, expressive API](https://legacy.electric-sql.com/docs/usage/data-access) for controlling what data syncs where and binding it reactively to your components.

### Sync strategies

When you're building local-first or offline-capable apps, there are a range of sync strategies you may choose to employ. From pinned queries to live subscriptions to row-based or schema-based filtering.

<div class="my-6 mt-8">
  <figure class="figure mx-0 my-3">
    <a href="/img/blog/introducing-electric-sql/spectrum-sync-models.jpg"
        class="relative block text-center w-full no-visual"
        target="_blank">
      <img src="/img/blog/introducing-electric-sql/spectrum-sync-models.sm.jpg"
          class="figure-img img-fluid mx-auto"
      />
    </a>
  </figure>
  <figcaption class="figure-caption text-end text-small mb-3 mb-9 max-w-lg ml-auto">
    Table summarising a range of sync strategies with increasing offline capabilities.
  </figcaption>
</div>

With Electric, we've worked hard to design a system where you can express all of these different models. We do this using a core primitive called [Shapes](https://legacy.electric-sql.com/docs/usage/data-access/shapes).

### Shape-based sync

A [Shape](https://legacy.electric-sql.com/docs/usage/data-access/shapes) is a set of related data that's synced onto the local device. It is defined by:

- a `table`, in your electrified DDL schema, such as projects
- a `query`, with where clauses used to filter the rows in that table
- an `include` tree, a directed acyclic graph of related data (like the association graph you might include with an ORM query)

You can sync wide, shallow shapes, such as a small set of columns from all rows in a table. You can sync deep nested shapes, such as an individual project with all its related content. For example, this sync call causes a project and all its issues, their comments and comment authors to sync atomically onto the local device:

```tsx
await db.projects.sync({
  where: {
    id: 'abcd'
  },
  include: {
    issues: {
      include: {
        comments: {
          include: {
            author: true
          }
        }
      }
    }
  }
})
```

With our `v0.6` release, we publish the first iteration of the implementation of this system. The current implementation:

- provides the type-safe `sync()` function
- efficiently loads shapes
- deduplicates overlapping shapes
- maintains resilient, persistent shape subscriptions

Filtered where-clauses and include-trees are coming next in `v0.6`. After that we will extend the subscription and retention semantics and iterate on support for data segmentation.

### Live queries

Once you've synced data onto the device, you can [bind live queries to your components](https://legacy.electric-sql.com/docs/usage/data-access/queries):

```tsx
const MyComponent = () => {
  const { results } = useLiveQuery(
    db.projects.liveMany({
      where: {
        status: 'active'
      }
    }
  )

  return (
    <List items={results} >
  )
)
```

And [write directly to the local database](https://legacy.electric-sql.com/docs/usage/data-access/writes) with automatic reactivity and replication:

```tsx
await db.projects.update({
  data: {
    status: 'completed'
  },
  where: {
    id: project.id
  }
})
```

Components automatically re-render when necessary. Data is automatically replicated using the shape subscriptions you've established. In many cases, there's no need for an additional state-management library. Just use the database as a unified store for data and UI state.


## Modern, local-first apps

We hope that gives you a sense of the [v0.6 release of ElectricSQL](https://legacy.electric-sql.com/docs). It's sync for modern apps. From the [inventors of CRDTs](/about/team). That you can use to build reactive, realtime, local-first apps using standard open-source technologies.

You get apps that are:

- [snappy, instant feeling](https://legacy.electric-sql.com/docs/intro/local-first) &mdash; with no lag or loading spinners
- [naturally realtime](https://legacy.electric-sql.com/docs/intro/multi-user) &mdash; with native support for multi-user collaboration
- [naturally offline-capable](https://legacy.electric-sql.com/docs/intro/offline) &mdash; with conflict-free concurrency and integrity guarantees
- [naturally local-first](https://legacy.electric-sql.com/docs/intro/active-active) &mdash; with data ownership built in and cloud-sync optional

Using standard open-source technologies:

- [standard open source Postgres](https://legacy.electric-sql.com/docs/usage/installation/postgres) on the backend
- [standard open source SQLite](https://legacy.electric-sql.com/docs/integrations/drivers) (with [full SQL support](https://legacy.electric-sql.com/docs/usage/data-access/queries#raw-sql)) on the front-end

Tied together with an open source [Protobuf web socket protocol](https://legacy.electric-sql.com/docs/api/satellite) and an open source [Elixir sync service](https://legacy.electric-sql.com/docs/api/service) that leverages the concurrency and resilience of the [BEAM](https://www.erlang.org/blog/beam-compiler-history/).