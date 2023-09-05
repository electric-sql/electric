---
title: Client
description: >-
  Type-safe database client generated from your data model.
sidebar_position: 20
---

ElectricSQL provides a schema-aware, type-safe database client from the [electrified subset](../data-modelling/electrification.md) of your [Postgres&nbsp;DDL&nbsp;schema](../data-modelling/migrations.md).

Generate this Typescript client as part of your build process, instantiate it within your local application and then use it to [sync shapes](./shapes.md), [query](./queries.md) and [write](./writes.md) data.

## Generating the client

Use the [generator script](../../api/generator.md) to generate the [Typescript client](../installation/client.md):

```shell
npx electric-sql generate
```

By default this outputs a `./src/generated/client` folder with an `index.ts` file as an entrypoint for you to import into your application code when instantiating your database client.

## Instantiating the client

The exact code for instantiating your database client depends on the SQLite driver that you're using for your target environment. However, the steps are the same across drivers:

1. initialise an SQLite database connection (`conn`) using your underlying driver
2. import your database schema (`schema`) from the `./generated/client` folder
3. configure your [authentication token](../auth/index.md) (`config.auth.token`)
4. pass these to your driver's `electrify` function to instantiate the client

For example, for [wa-sqlite](../../integrations/drivers/web/wa-sqlite.md) in the web browser:

```tsx
import { ElectricDatabase, electrify } from 'electric-sql/wa-sqlite'
import { schema } from './generated/client'

const config = {
  auth: {
    token: '...'
  }
}

const init = async () => {
  const conn = await ElectricDatabase.init('my.db', '/')

  return electrify(conn, schema, config)
}
```

See <DocPageLink path="integrations/drivers" /> and <DocPageLink path="api/clients/typescript" /> for more information.

## Using the client

The client then provides a Prisma-inspired API for syncing shapes, defining queries and making writes, as well as the ability to drop down to raw SQL when necessary.

For example:

```ts
const { db } = await init()
const results = await db.projects.findMany()
```

See the next pages on [shapes](./shapes.md), [queries](./queries.md) and [writes](./writes.md) and the <DocPageLink path="api/clients/typescript" /> docs for more detailed information on the specific function calls.

:::info Note
Typically you would instantiate the client once and then pass it around via some kind of context machinery. See <DocPageLink path="integrations/frontend" /> for more information.
:::
