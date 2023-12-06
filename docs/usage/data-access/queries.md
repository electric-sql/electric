---
title: Queries
description: >-
  Bind live queries to your components for reactive, realtime data.
sidebar_position: 40
---

Once data has [synced into your app](./shapes.md), you can read it from the local database. You have a choice of using the [Prisma-inspired](https://www.prisma.io/docs/concepts/components/prisma-client) client API. Or you can just [drop down to raw SQL](#raw-sql).

## Using the client

The client API supports both [static](#static-queries) and [live queries](#live-queries). Queries are table-scoped. You can [select columns](#select-columns), [sort, filter](#sort-and-filter) and [work with relations](#work-with-relations).

See <DocPageLink path="api/clients/typescript" /> for more details on the function API and supported arguments.

### Static queries

Read data using the [`findUnique`](../../api/clients/typescript.md#findUnique), [`findFirst`](../../api/clients/typescript.md#findFirst) and [`findMany`](../../api/clients/typescript.md#findMany) functions.

For example, to get a project by unique ID:

```ts
const result = await db.projects.findUnique({
  where: {
    id: 'abcd'
  }
})
```

Or to get all projects that have an 'active' status:

```ts
const result = await db.projects.findMany({
  where: {
    status: 'active'
  }
})
```

### Live queries

Register live queries using the [`liveUnique`](../../api/clients/typescript.md#liveUnique), [`liveFirst`](../../api/clients/typescript.md#liveFirst) and [`liveMany`](../../api/clients/typescript.md#liveMany) functions.

Live queries work similarly to the static queries above, except that rather than returning results directly, they return a function that you can call (as many times as you like) to run / re-run the query.

```tsx
const liveQuery = db.projects.liveMany({
  where: {
    status: 'active'
  }
})
const { results } = await liveQuery()
```

The real payoff comes when these are used in tandem with a [reactive component framework integration](../../integrations/frontend/index.md). For example, the following React component uses a `liveMany` query along with the [`useLiveQuery`](../../integrations/frontend/react.md#useLiveQuery) hook to bind live `results` to a React state variable:

```ts
const MyComponent = () => {
  const { db } = useElectric()!
  const { results } = useLiveQuery(
    db.projects.liveMany({
      where: {
        status: 'active'
      }
    })
  )

  // ...
}
```

See [Reacting to writes](./writes#reacting-to-writes) for more information.

### Select columns

Select specific columns using the `select` key:

```tsx
db.projects.liveMany({
  select: {
    id: true,
    status: true
  }
})
```

### Sort and filter

Filter results using `where`:

```tsx
db.projects.liveMany({
  where: {
    status: 'active'
  }
})
```

Where clauses support `not`, `in` and `notIn` operators:

```tsx
db.projects.liveMany({
  where: {
    id: {
      not: 0, 
      in: [1, 2, 3],
      notIn: [4, 5]
    }
  }
})
```

As well as `lt`, `lte`, `gt` and `gte`:

```tsx
db.projects.liveMany({
  where: {
    id: {
      lt: 10, 
      lte: 9,
      gt: 8,
      gte: 9
    }
  }
})
```

`startsWith`, `endsWith` and `contains`:

```tsx
db.projects.liveMany({
  where: {
    name: {
      startsWith: 'Electric', 
      endsWith: 'SQL',
      contains: 'cS'
    }
  }
})
```

`OR`, `AND` and `NOT`:

```tsx
db.projects.liveMany({
  where: {
    OR: [
      {
        title: {
          contains: 'foo',
        },
      },
      {
        title: 'bar',
      },
    ],
    AND: [
      {
        contents: 'content',
      },
      {
        nbr: 6,
      },
    ],
    NOT: [
      {
        title: 'foobar',
      },
      {
        title: 'barfoo',
      },
    ]
  }
})
```

Sort results using `orderBy`, either with single columns:

```tsx
db.projects.liveMany({
  orderBy: {
    id: 'desc'
  }
})
```

Or multiple columns:

```tsx
db.projects.liveMany({
  orderBy: [
    {
      priority: 'desc'
    },
    {
      createdAt: 'asc'
    }
  ]
})
```

Limit the number of results using `take`:

```tsx
db.projects.liveMany({
  orderBy: {
    createdAt: 'desc'
  },
  take: 10
})
```

### Work with relations

Include a nested tree of relations using `include`:

```tsx
db.projects.liveMany({
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

## Raw SQL

If the higher-level client API doesn't support the SQL features that you need for your queries, you can drop down to raw SQL yourself using the [`raw`](../../api/clients/typescript.md#raw) and [`liveRaw`](../../api/clients/typescript.md#raw) functions.

To run a static query (or just execute SQL):

```ts
const projects = db.raw({
  sql: 'select * from projects where id = ?',
  bindParams: ['abcd']
})
```

To run a live query that supports arbitrary SQL whilst still working automatically with the reactivity machinery to pick up on live changes:

```ts
const liveQuery = db.liveRaw({
  sql: 'select * from projects where id = ?',
  bindParams: ['abcd']
})
const { results } = liveQuery()
```

For example:

```tsx
const MyComponent = () => {
  const { db } = useElectric()!
  const { results } = useLiveQuery(
    db.liveRaw({
      sql: 'select * from projects where status = ?',
      bindParams: ['active']
    })
  )

  // ...
}
```
