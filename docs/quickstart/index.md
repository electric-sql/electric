---
title: Quickstart
sidebar_position: 10
---

import useBaseUrl from '@docusaurus/useBaseUrl'

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

import ModellingGenerator from './_modelling_generator.md';
import ModellingManual from './_modelling_manual.md';

import SetupGenerator from './_setup_generator.md';
import SetupManual from './_setup_manual.md';


Let's dive in and start developing with ElectricSQL. First, we'll get the stack setup, then we'll show you the basics of using the system.

:::note
If you'd prefer to understand a bit more about the system before jumping into code, start with the <DocPageLink path="intro/local-first" /> instead.
:::

## Setup

Get setup quickly using the [`create-electric-app`](../api/generator.md) generator. Or install, run and integrate the components yourself.

<Tabs groupId="setup" queryString>
  <TabItem value="generator" label="Use the generator">
    <SetupGenerator />
  </TabItem>
  <TabItem value="manual" label="Install yourself">
    <SetupManual />
  </TabItem>
</Tabs>

## Usage

The next section goes over the basics of using ElectricSQL. It's a quick summary of the information you'll find in more detail in the [Usage](../top-level-listings/usage.md) guide.

### Define your schema

<Tabs groupId="setup">
  <TabItem value="generator" label="Generator" attributes={{className: 'hidden'}}>
    <div className="-mt-4">
      <ModellingGenerator />
    </div>
  </TabItem>
  <TabItem value="manual" label="Manual" attributes={{className: 'hidden'}}>
    <div className="-mt-4">
      <ModellingManual />
    </div>
  </TabItem>
</Tabs>

### Expose data

Expose data using [DDLX rules](../api/ddlx.md). First, [electrify](../usage/data-modelling/electrification.md) each table you'd like to sync:

```sql
ALTER TABLE items
  ENABLE ELECTRIC;
```

Then assign [roles and access permissions](../usage/data-modelling/permissions.md):

```sql
ELECTRIC GRANT ALL
  ON items
  TO ANYONE;
```

### Authenticate

[Authenticate](../usage/auth/index.md) the local app with the replication protocol using a JSON Web Token:

```tsx
const config = {
  auth: {
    token: '<your JWT>'
  }
}
```

### Instantiate

Wrap your [SQLite driver](../integrations/drivers/index.md) with a type-safe, schema-aware [database Client](../usage/data-access/client.md):

```tsx
import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'
import { schema } from './generated/client'

const conn = await ElectricDatabase.init('my.db', '')
const { db } = await electrify(conn, schema, config)
```

### Sync data

Sync data into the local database using [Shapes](../usage/data-access/shapes.md):

```tsx
const shape = await db.items.sync({
  where: {
    // ... clauses
  },
  include: {
    // ... relations
  }
})
```

### Read data

Bind live data to your components using [Live queries](../usage/data-access/queries.md#live-queries):

```tsx
const { results } = useLiveQuery(
  db.items.liveMany({
    where: {
      // ... filter
    },
    select: {
      // ... columns
    },
    orderBy: {
      // ... sort
    },
    take: 20
  })
)
```

Either using the [Prisma-inspired client](../usage/data-access/queries.md) or if you prefer just [raw SQL](../usage/data-access/queries.md#raw-sql):

```tsx
const { results } = useLiveQuery(
  db.liveRaw({
    sql: 'SELECT * FROM items where foo = ?',
    args: ['bar']
  })
)
```

### Write data

Write data directly to the local database using [Local writes](../usage/data-access/writes.md):

```tsx
const item = await db.items.create({
  data: {
    // ... item data
  }
})
```

Writes automatically cause any relevant live queries to update. For example, if you take the following component:

```tsx
const MyComponent = () => {
  const { db } = useElectric()!
  const { results } = useLiveQuery(
    db.items.liveMany()
  )

  const add = async () => (
    await db.items.create({
      data: {
        value: uuid()
      }
    })
  )

  return <List items={results} add={add} />
}
```

Calling `add` will insert a new item into the local database. ElectricSQL will automatically detect and replicate the write. The replication process emits a notification, causing the live query to re-run. This updates the value of the `results` state variable, which triggers the component to re-render.

This automatic reactivity works no matter where the write is made &mdash; locally, [on another device, by another user](../intro/multi-user.md), or [directly into Postgres](../intro/active-active.md).

## Next steps

Take a look at the <DocPageLink path="examples" />, see the <DocPageLink path="usage" /> and <DocPageLink path="integrations" /> guides and the <DocPageLink path="api" /> docs.

<div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-5 lg:mb-6">
  <div className="tile">
    <div className="px-3 md:px-4">
      <a href="/docs/examples">
        <h3>
          Examples
        </h3>
        <p className="text-small mb-2">
          Example apps using ElectricSQL.
        </p>
      </a>
    </div>
  </div>
  <div className="tile">
    <div className="px-3 md:px-4">
      <a href="/docs/usage">
        <h3>
          Usage
        </h3>
        <p className="text-small mb-2">
          How to use ElectricSQL.
        </p>
      </a>
    </div>
  </div>
  <div className="tile">
    <div className="px-3 md:px-4">
      <a href="/docs/integrations">
        <h3>
          Integrations
        </h3>
        <p className="text-small mb-2">
          Integrate ElectricSQL with your stack.
        </p>
      </a>
    </div>
  </div>
  <div className="tile">
    <div className="px-3 md:px-4">
      <a href="/docs/api">
        <h3>
          API docs
        </h3>
        <p className="text-small mb-2">
          Normative API docs.
        </p>
      </a>
    </div>
  </div>
</div>

You can also [join the Discord community](https://discord.electric-sql.com) and [star us on GitHub](https://github.com/electric-sql/electric).
