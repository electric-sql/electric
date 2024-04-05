---
title: Shapes
description: >-
  The core primitive for controlling sync in the ElectricSQL system.
sidebar_position: 30
---

Shapes are the core primitive for controlling sync in the ElectricSQL system.

Local apps ask the server for a specific set of related data that gets synced to the local device. The central Postgres instance will always have too much data to fit on any one device, so shapes allow us to sync only a required subset of data onto the device. There is a balance between local data availability and storage usage on the device that is unique to every application, and shapes allow you to balance those properties while maintaining required guarantees.

:::caution Work in progress
Shapes are being actively developed, so see the list of [limitations](#limitations) at the bottom of the page.
:::

## What is a shape?

A shape is a set of related data that's synced onto the local device. It is defined by:

- a **root table**, in your [electrified DDL schema](../data-modelling/electrification.md), such as `projects`
- a **query**, with where clauses used to filter the rows in that table
- an **include tree**, a directed acyclic graph of related data

For example, this `sync` call causes a project and all its issues, their comments and comment authors to sync atomically onto the local device:

```js
await db.projects.sync({
  where: {
    id: "abcd",
  },
  include: {
    issues: {
      include: {
        comments: {
          include: {
            author: true,
          },
        },
      },
    },
  },
});
```

Once the data has synced onto the local device, it's kept in sync using a **shape subscription**. This monitors the replication stream and syncs any new data, updates and deletions onto the local device for as long as the shape's [subscription and retention semantics](#subscription-and-retention-semantics) define.

### Foreign key and query consistency

ElectricSQL maintains foreign key consistency both in PostgreSQL central database, and in SQLite database on the client. To achieve it, the server will automatically follow any many-to-one relation in the requested shape. For example, if there are projects with related issues and with an owner, requesting all projects will also ensure that owners of those projects are available on the device too, but related issues won't show up on the device unless explicitly requested.

## Syncing shapes

ElectricSQL syncs shapes using the [`sync`](../../api/clients/typescript.md#sync) client function. You can sync individual rows:

```ts
await db.projects.sync({
  where: {
    id: "abcd",
  },
});
```

You can sync filtered sets of rows:

```ts
await db.projects.sync({
  where: {
    status: "active",
  },
});
```

You can sync deep nested shapes, such as an individual project with all its related content:

```ts
await db.projects.sync({
  where: {
    id: "abcd",
  },
  include: {
    issues: {
      include: {
        comments: {
          include: {
            author: true,
          },
        },
      },
    },
  },
});
```

### Filter clauses

You can filter data at the top of the shape, or when including data over a one-to-many relation using a `where` clause on the request object. Shape `where` clauses may be either an object, or a string. They may only reference the columns on the filtered table itself. It's important that many-to-one relations cannot be filtered that way (e.g. you cannot do `comments: { include: { author: { where { id: true }}}}`), because if a
target row would be filtered out, that would break FK consistency on the client.

#### Object `where` clause

:::caution Work in progress
TypeScript type of the object accepted in `.sync` call may be wider than what is actually supported.
:::

When filtering using an object, you can use Prisma-like syntax. Direct value comparisons are supported, as well as the following filtering functions:

- `equals`
- `in`
- `not`
- `notIn`
- `lt`
- `lte`
- `gt`
- `gte`
- `startsWith`
- `endsWith`
- `contains`

They can be combined as multiple parts of the same clause, and explicitly using:

- `AND`
- `OR`
- `NOT`

For example:

```ts
await db.projects.sync({
  where: {
    status: {
      in: ["active", "pending"],
    },
  },
});
```

See the <DocPageLink path="api/clients/typescript" /> docs for more details.

#### String `where` clause

:::note Work in progress
String `where` clause is currently only supported as top-level filtering. This will be fixed in a future release.
:::

Because the where clause will be applied on Postgres and on the ElectricSQL server, you can drop down to a string representation that's close to PostgreSQL `WHERE` clause on a regular query. You can use the usual PostgreSQL syntax, although not all functions are supported. Columns of the table you're filtering can be referenced using `this.` prefix:

```ts
await db.projects.sync({
  where: "this.status IN ('active', 'pending')",
});
```

This allows for more flexibility (i.e. not entire supported PostgreSQL subset can currently be expressed via a Prisma-like API), but you have to be more careful with interpolating your own values in the string in a format that PostgreSQL would accept for the expected type.

```ts
await db.projects.sync({
  where: "lower(this.status) ~~ 'pending%'",
});
```

Full current list of supported Postgres functions is easiest found [in code](https://github.com/electric-sql/electric/blob/main/components/electric/lib/electric/replication/eval/env/known_functions.ex), but here's a gist:

- Types (input, comparison): all numerics, `bool`, `uuid`, `text`
- Numeric functions: all basics + bitwise operations
- String functions: concatenation, `LIKE`/`ILIKE`

:::note Work in progress
More basic type filtering support is being added, as well as more functions over those types.
:::

:::warning Limitation
Current filtering implementation does not support non-deterministic functions. You cannot have `now()` PostgreSQL function in the where clause, because there's currently no way for us to garbage-collect rows that fall out of e.g. `this.updated_at > now()` filter without an update to the row itself.
:::

### Promise workflow

The [`sync`](../../api/clients/typescript.md#sync) function resolves to an object containing a promise:

1. the first `sync()` promise resolves when the shape subscription has been confirmed by the server (the sync service)
2. the second `synced` promise resolves when the data in the shape has fully synced onto the local device

```tsx
// Resolves once the shape subscription
// is confirmed by the server.
const shape = await db.projects.sync();

// Resolves once the initial data load
// for the shape is complete.
await shape.synced;
```

If the shape subscription is invalid, the first promise will be rejected. If the data load fails for some reason, the second promise will be rejected.

### Data loading

Data synced onto the local device via a shape subscription appears atomically in the local database. I.e.: it all loads within a single transaction.

You can query the local database at any time, for example, establishing a [Live query](./queries.md#live-queries) at the same time as initiating the shape sync. The query results will initially be empty (unless data is already in the local database) and then will update once with the full set of data loaded by the shape subscription.

For example, this is OK:

```tsx
const MyComponent = () => {
  const { db } = useElectric()!;
  const { results } = useLiveQuery(db.projects.liveMany());

  // console.log('MyComponent rendering')
  // console.log('results', results)

  const syncProjects = async () => {
    // console.log('syncProjects')

    const shape = await db.projects.sync();
    // console.log('shape subscription confirmed')

    await shape.synced;
    // console.log('shape data synced')
  };

  useEffect(() => {
    syncProjects();
  }, []);

  return <h1>{results.length}</h1>;
};
```

Or you can explicitly wait for the sync, for example, by conditionally rendering a child component once `shape.synced` has resolved:

```tsx
const MyContainer = () => {
  const { db } = useElectric()!;
  const [ready, setReady] = useState(false);

  // console.log('MyContainer rendering')
  // console.log('ready', ready)

  const syncProjects = async () => {
    // console.log('syncProjects')

    const shape = await db.projects.sync();
    // console.log('shape subscription confirmed')

    await shape.synced;
    // console.log('shape data synced')

    setReady(true);
  };

  useEffect(() => {
    syncProjects();
  }, []);

  if (!ready) {
    return null;
  }

  return <MyComponent />;
};

const MyComponent = () => {
  const { db } = useElectric()!;
  const { results } = useLiveQuery(db.projects.liveMany());

  // console.log('MyComponent rendering')
  // console.log('results', results)

  return <h1>{results.length}</h1>;
};
```

For many applications you can simply define the data you want to sync up-front, for example, at app load time and then just code against the local database once the data has synced in. For others, you can craft more dynamic partial replication, for instance, syncing data in as the user navigates through different routes or parts of the app.

#### Updating shapes

:::danger Potential foot-gun in development :::

Once a subscription is established, it remains statefully in SQLite database even when you change the code. For example, doing `db.projects.sync({ where: { id: 1 }})`, starting the application, then changing the code to `db.projects.sync({ where: { id: 2 }})` will result in **2 subscriptions** established, with both projects synced to the device. We're working on lifting this limitation.

#### Move-in lag

You can define you shape to follow a one-to-many relation with a filter at the top, and see a row being updated to now satisfy the filter:

```ts
await db.projects.sync({
  where: { status: "active" },
  include: { issues: true },
});
```

If a project were to change it's status to `active`, the client would be eligible to see it, but also would be interested in the issues of this newly visible project. Due to consistency considerations, those additional rows that come from following a one-to-many relation will show up on the device slightly later than the project row itself. It's important to keep this in mind when designing the UI.

:::note Work in progress
We expect to add client-side hooks notifying of such move-in events so that UI has more information to act upon.
:::

## Limitations and issues

Shape-based sync is under active development, and we're aware of some issues with it. We're working on fixing the bugs and lifting limitations as we go.

- `.sync` method has a wider type signature in TypeScript than what's really supported. In particular, `limit`, `sort` and other keywords under `include` should not be there.
- `DELETE` of the top row on the client without having synced all the children may not result in a `DELETE` on the server and the row will be restored
- Recursive and mutually recursive tables are not supported at all for now. A FK loop will prevent the shape subscription from being established.
- Shape unsubscribe is not available, which means any `.sync` method (in development in particular) is going to be statefully persisted regardless of code changes.

## Future capabilities

Shape-based sync is under active development. We aim soon to provide additional capabilities and primitives, such as the ones outlined below.

### Segmentation indexes

When a shape subscription is established, the initial data load (the rows in the shape) are fetched by a Postgres query. However, ongoing changes from the replication stream are mapped into shapes by the Electric sync service.

This limits the expressiveness of shape filter clauses to the matching capabilities of the sync service (as opposed to the full query capabilities of Postgres). Segmentation indexes are a mechanism to pre-define virtual columns as user-defined functions in the Postgres database, in order to support abitrary query logic in shape definitions.

### Subscription and retention semantics

Currently all shapes are always live. However, in some cases, you may want to make ephemeral queries and keep results available for offline use without always keeping them live and up-to-date. Subscription semantics will allow you to configure whether a shape subscription is maintained to keep the data synced in a shape live or not.

Currently all synced data is retained forever until explicitly deleted. Retention semantics will provide a declarative API to control data retention and deterministic behaviour when there's contention for storage resources.

### Discovered shapes

Many applications need to provide listings and search capabilities. You don't always want to sync the whole search index or table onto the local device to support this.

Discovery queries allow you to "discover" the results of a query run server-side on Postgres and to then subscribe to the query results. This allows you to keep a shape subscription live for a search or listing query.

### Derived shapes

Derived shapes are shapes that are derived from a component hierarchy. They are analogous to the way that fragments are aggregated into a top-level query by the Relay compiler.
