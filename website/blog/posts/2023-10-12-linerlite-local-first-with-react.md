---
title: Linearlite - A local-first app built with ElectricSQL and React
description: >-
  A demo ElectricSQL app built with React - “Linearlite” a simplified, lightweight clone of the Linear project management and issue tracking tool.
excerpt: >-
  Introducing Linearlite, a simplified, lightweight clone of Linear.app
  built with Electric.
authors: [samwillis]
image: /img/blog/linerlite-local-first-with-react/header.jpg
tags: [example app]
outline: deep
post: true
---

Recently at Electric we’ve been building some demo apps; this is both to demonstrate the capability and use of Electric as platform, and to help inform our design process. The first of these demos is what we’re calling “Linearlite” - a simplified, lightweight clone of the Linear project management and issue tracking tool. <!--truncate--> It uses the standard ElectricSQL architecture of Postgres on the server, SQLite in the browser, and Electric’s sync layer in the middle.

![](/img/blog/linerlite-local-first-with-react/app.png)

You can try out Linearlite here: [https://linear-lite.electric-sql.com](https://linear-lite.electric-sql.com/)

At Electric we already use the original Linear internally, and so know it well; replicating its functionality seemed like a great place to start when testing out our own development tools.

For this first version we simplified a few things:

- No user system
- Only a single project
- Simpler level of statuses, roadmaps, milestones etc.

This demo app demonstrates a number of the key foundational concepts of Electric. Namely:

- [Reactive live queries](#reactive-live-queries-one-way-dataflow-and-ui-updates)
- [Offline support](#instant-interactions-and-offline-mode)
- [Compensations](#compensations-and-last-write-wins)

Further on in this post we will also demonstrate how to implement [conflict free reordering with the kanban board](#compensations-and-last-write-wins).

Finally, you’ll find a brief breakdown of [how we built Linearlite](#how-we-built-linearlite).

## ElectricSQL and it’s concepts that Linearlite demonstrate

ElectricSQL is an open source local-first software platform. Use it to build super fast, collaborative, offline-capable apps directly on Postgres by syncing to a local SQLite database.

Electric comprises a [sync layer](/docs/api/service) (built with Elixir) placed in front of your Postgres database, and a [type-safe client](/docs/api/clients/typescript) allowing you to bidirectionally sync data from your Postgres to local SQLite databases. This sync is [CRDT-based](/docs/reference/consistency), resilient to conflicting edits from multiple nodes at the same time, and works after being offline for extended periods.

In some ways Electric is similar to Hasura or PostgREST in that it can provide a plug-and-play API to your Postgres database. However, there are three key differences:

- SQL throughout - it’s SQL on the server _and_ SQL on the client. 
- Offline support - you get offline _for free,_ you don’t have to build any complex syncing logic.
- Reactive queries - build a UI declaratively that updates as the underlying database changes.

There are a number of additional advantages to this architecture. First, with users’ data being on their devices, this naturally results in fast interaction; no more loading spinners, and your apps can _"just work"_ offline. Additionally, multi-user Electric apps are inherently realtime multiplayer experiences - your UI will update in realtime based on any and all changes from any user of the app.

After six moths of intensive development we have [just released v0.6 of Electric](/blog/2023/09/20/introducing-electricsql-v0.6), which has received an overwhelmingly positive response. This version makes it possible to easily host the sync layer yourself, and to start building apps today.

### Reactive live queries, one-way dataflow and UI updates

Electric enables you to execute reactive live queries, which automatically update when the underlying tables of the query change. When combined with a framework such as React using a one-way dataflow architecture this results in very simple state management. In most cases there is no further need for client side state stores in combination with server side apis, nor any of the complexity of keeping them in sync.

In this video you can see that when an issue is created in Linearlite it is both added to the list within the app, but also reactively on other instances of the app too.

<video className="w-full" controls poster="/videos/blog/linerlite-local-first-with-react/reactive_queries.jpg">
  <source src="/videos/blog/linerlite-local-first-with-react/reactive_queries.mp4" />
</video>

This example shows the UI of one visitor updating automatically when another user edits an issue in realtime.

<video className="w-full" controls poster="/videos/blog/linerlite-local-first-with-react/live_editing.jpg">
  <source src="/videos/blog/linerlite-local-first-with-react/live_editing.mp4" />
</video>

### Instant Interactions and Offline Mode

As Electric has synchronised the database to the user’s device, the result is near-instantaneous interactions whenever the user interacts with Linearlite, or any app built with Electric. This video shows a user searching for, and then opening, an issue. The lack of loading states, or spinners, combined with the speed of execution would feel to a user as though they were working on a local app. Which, in fact, they are.

<video className="w-full" controls poster="/videos/blog/linerlite-local-first-with-react/quick.jpg">
  <source src="/videos/blog/linerlite-local-first-with-react/quick.mp4" />
</video>

In addition, as the database is synced to the device, the apps also work offline. In Linearlite we have added a toggle button in the user menu which lets you test the offline capability.

<video className="w-full" controls poster="/videos/blog/linerlite-local-first-with-react/offline.jpg">
  <source src="/videos/blog/linerlite-local-first-with-react/offline.mp4" />
</video>

### “Compensations” and “Last Write Wins”

Electric is built upon [_rich-CRDTs_](/blog/2022/05/03/introducing-rich-crdts) - this is key to enabling offline and conflict free syncing, and forms the central core of the Electric system. For the most part, when two users concurrently edit the same record (or issue in the case of Linearlite), the last operation wins.

However, in a relational database there are some further complexities. Records can be linked to one another, this is often enforced in the database though foreign keys, ensuring that all records that have a foreign key always link to a record that exists. This is know as referential integrity.

Electric employs the concept  of “[Compensations](/blog/2022/05/03/introducing-rich-crdts#compensations)” from rich-CRDTs. These are, as the name suggests, compensations which Electric applies to resolve the state of the database, ensuring referential integrity is maintained.

When issues are tracked in Linearlite, multiple comments can be associated with each individual issue. Therefore, if one user deletes an issue concurrently with another user posting a related comment, it is imperative that this data is preserved. In this case, Electric understands that a new comment has been added with a foreign key linking to a now-deleted issue; in order to maintain the comment and referential integrity the issue is thus ‘resurrected’. You can see this in action in the following video.

<video className="w-full" controls poster="/videos/blog/linerlite-local-first-with-react/compensations.jpg">
  <source src="/videos/blog/linerlite-local-first-with-react/compensations.mp4" />
</video>

### Conflict free reordering of a kanban board

One key feature of project management issue trackers is a kanban board, and so we wanted to demonstrate how this could be built with Electric.

In Linearlite each issue has a status check which can be set to one of five different values. On the kanban board, the display filters each issue into one of five columns, with each column corresponding to one of the five set values. However, there also needs to be the functionality to change the order of issues within a column, but also to facilitate the reclassification of an issue by permitting movement between the five columns.

This is achieved with an order value in the database, which needs to then work in a conflict free manner. For Linearlite we have utilised fractional indexing for this using [this brilliant implementation](https://www.npmjs.com/package/fractional-indexing) of [David Greenspan’s fractional indexing algorithm](https://observablehq.com/@dgreensp/implementing-fractional-indexing).

<video className="w-full" controls poster="/videos/blog/linerlite-local-first-with-react/kanban.jpg">
  <source src="/videos/blog/linerlite-local-first-with-react/kanban.mp4" />
</video>

## How we built Linearlite

Linearlite started from our `npx create-electric-app@latest`. To find out more about this see our [Quickstart](/docs/quickstart).

All source code for Linearlite is in [/examples/linearlite](https://github.com/electric-sql/electric/tree/main/examples/linearlite)

If you would like to run Linearlite locally you can check it out with:

```bash
git clone https://github.com/electric-sql/electric.git electric-linearlite
cd electric-linearlite/example/linearlite
```

### Database schema and migrations

The app has a very simple database schema. At the end of the DDL you will see a call to ‘Electrify’ the tables - this is how we activate Electric’s ‘magic’, making it possible to sync the table down to SQLite.

We use UUIDs for the primary key of each issue and comment, this enables us to generate them on the client whilst offline.

Due to some current limitations we have used strings for date stamps in this first version, but this restriction will be lifted in a future version of Electric.

```sql
-- db/migration/create/create_tables.sql

CREATE TABLE IF NOT EXISTS "issue" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,   
  "description" TEXT NOT NULL,
  "priority" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "modified" TEXT NOT NULL,
  "created" TEXT NOT NULL,
  "kanbanorder" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  CONSTRAINT "issue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "comment" (
  "id" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "issue_id" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "comment_pkey" PRIMARY KEY ("id"),
  FOREIGN KEY (issue_id) REFERENCES issue(id)
);

-- ⚡
-- Electrify the tables
CALL electric.electrify('issue');
CALL electric.electrify('comment');
```

To start a Postgres docker container, along with the sync service, and migrate the db you can run:

```bash
npm run backend:start
npm run db:migrate
```

### Generating a type-safe client

Electric generates a type-safe client for your Electrified tables. There are two parts to this:

1. The “Electric Satellite”. This is responsible for synchronising your local copy with that on the server. It is able to subscript a “shape” - this is a description of a subset of tables and rows (using a `where` clause) that you would like to copy to your user’s device. It then also monitors the local copy, synchronising any changes or additions.
1. A [type-safe data access library](/docs/api/clients/typescript), or DAL. This is a TypeScript library that allows you to interact with, and perform queries on, your local copy of the database. It enforces runtime type-safety on all operations to ensure that the local database doesn’t reach a state that is not compatible with the server.

To generate the client you run:

```bash
npm run client:generate
```

### Initiating Electric in a React app

Our `create-electric-app` starter provides some initial scaffolding to get you started with a ElectricSQL & React app.

For the UI, we used the brilliant Linear clone by [Tuan Nguyen](https://github.com/tuan3w) as a basis. We simplified the design a little, paring it back to the core functionality we wanted to demonstrate, and replaced the state system with Electric an our one way dataflow pattern.

A key file is `/src/electric.ts` - This file contains an `initElectric` function that first creates a local SQLite database and then “Electrifies” it. It also defines an Electric context; this is an extended version of a standard React context that you can then use to access your Electric database anywhere in your code.

```typescript
// src/electric.ts
import { makeElectricContext } from 'electric-sql/react'
import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'

// The generated electric client:
import { Electric, schema } from './generated/client'
export type { Issue } from './generated/client'

export const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

export const initElectric = async () => {
 const electricUrl = import.meta.env.ELECTRIC_URL ?? 'ws://localhost:5133'
 const config = {
  auth: {
   token: insecureAuthToken({ user_id: uuid() }),
  },
  url: electricUrl,
 }
 const conn = await ElectricDatabase.init(dbName, '/')
 return await electrify(conn, schema, config)
}

```

In the `App.tsx` file you will find code that imports `initElectric`, runs it to create your database, and then passes the Electric database to an `<ElectricProvider>` component to make it available to any components in your app:

```typescript
// src/App.tsx
import { ElectricProvider, initElectric } from './electric'

const App = () => {
 const [electric, setElectric] = useState<Electric>()

 useEffect(() => {
  const init = async () => {
   const client = await initElectric()
   setElectric(client)
   // ... snip ...
  }
  init()
 }, [])

 // ...

 return (
  <ElectricProvider db={electric}>
	// ...
  </ElectricProvider>
 )
}

```

There are more details of how to [initialise an Electric client database in the documentation](/docs/api/clients/typescript#instantiation).

### Syncing data to the local database

Once our Electric client is set up and made available to our whole app using the provider component, we now need to initiate an ongoing bidirectional sync with the server.

In the `init` function inside the useEffect in the App component we add the code below:

```typescript
// src/App.tsx
const { synced } = await client.db.issue.sync({
 include: {
  comment: true,
 },
})
await synced
```

This instructs Electric to sync the entire issues table and any related comments to the local database. In future versions of Electric you will be able to configure partial replication using this api and `where` clauses.

See the [documentation for more details on how to define partial replication](/docs/api/clients/typescript#sync).

### Database queries

In any component where you want to access your database you employ `useElectric` to retrieve your Electric instance:

```typescript
// src/pages/Issue/index.tsx
import { useElectric } from '../../electric'

function IssuePage() {
 const { db } = useElectric()!
 // ...
}
```

Throughout Linearlite we use the Electric DAL for a number of queries. Below are a few brief examples.

**Example 1:** Creating an issue:

```typescript
// src/components/IssueModal.tsx
const date = new Date().toISOString()
db.issue.create({
 data: {
  id: uuidv4(),
  title: title,
  username: 'testuser',
  priority: priority,
  status: status,
  description: description,
  modified: date,
  created: date,
  kanbanorder: kanbanorder,
 },
})
```

Here we use the `.create()` method to insert a new issue record into the database.

See the [documentation for ".create()"](/docs/usage/data-access/queries) for more details on how this method works.

**Example 2:** Updating an issue title:

```typescript
// src/pages/Issue/index.tsx
await db.issue.update({
 data: {
  title: title,
  modified: new Date().toISOString(),
 },
 where: {
  id: issue.id,
 },
})

```

This uses the `.update()` method with a `where` clause to specify which issue to update.

See the [documentation for ".update()"](/docs/usage/data-access/queries) for more details on how this method works.

**Example 3:** Fetching a live query of issues for the issue list:

```typescript
// src/pages/List/index.tsx
const { results } = useLiveQuery(
 db.issue.liveMany({
  orderBy: {
   kanbanorder: 'asc',
  },
  where: filterStateToWhere(filterState),
  // `filterStateToWhere` is a helper function that converts the filter 
  // state (tied to url parameters) to a where caluse for the query.
 })
)
```

Here we are using our `useLiveQuery` React hook, passing it a liveMany query. The `useLiveQuery` is a ‘helper’ that sets up a ‘listener’ to detect any changes to the database and return an updated results set when needed. This reactive live query forms the basis of our one way dataflow in the app.

If you want to dig further into how Linearlite works do take a look at the code, or pop into our Discord to ask any question that you may have.

See the [documentation for live queries](/docs/usage/data-access/queries#live-queries) for more details on the available options.

## Future plans

As we add further functionality to ElectricSQL - [see our roadmap](/docs/reference/roadmap) - we are going to continue to evolve Linearlite, adding additional features in order to demonstrate the evolving capabilities of Electric. Exciting planned features for future versions include:

- User support, demonstrating permissions
- Partial sync, demonstrating our “shapes” system
- Progressive web app support for installable web apps and true offline
