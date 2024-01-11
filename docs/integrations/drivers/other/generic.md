---
title: Generic
description: >-
  Create your own adapter ...
sidebar_position: 10
---

You can integrate any SQLite database driver by adapting it to the ElectricSQL [`DatabaseAdapter` interface](https://github.com/electric-sql/electric/blob/main/clients/typescript/src/electric/adapter.ts):

```tsx
export interface DatabaseAdapter {
  // Database connection instance from your driver library.
  db: AnyDatabase

  // Run the provided sql statement. A statement has the
  // form of `{sql: string, bindParams?: string[]}`.
  run(statement: Statement): Promise<RunResult>

  // Run an array of sql statements within a transaction.
  runInTransaction(...statements: Statement[]): Promise<RunResult>

  // Run a query statement and return the results as an
  // array of rows.
  query(statement: Statement): Promise<Row[]>

  // Run the provided function inside a transaction.
  transaction<T>(
    f: (tx: Transaction, setResult: (res: T) => void) => void
  ): Promise<T | void>

  // Get the tables potentially used by an SQL statement.
  // This supports reactivity for raw SQL use via the
  // `db.liveRawQuery` function.
  tableNames(statement: Statement): QualifiedTablename[]
}
```

The best guidance for this is to look at the [existing driver implementations](https://github.com/electric-sql/electric/tree/main/clients/typescript/src/drivers). You can then build on the [base electrify function](https://github.com/electric-sql/electric/blob/main/clients/typescript/src/electric/index.ts#L33) to implement your own `electrify` function, e.g.:

```tsx
export const electrify = async <T, DB extends DbSchema<any>>(
  db: T,
  dbDescription: DB,
  config: ElectricConfig,
  opts?: ElectrifyOptions
): Promise<ElectricClient<DB>> => {
  const dbName = db.name
  const adapter = opts?.adapter || new MyDatabaseAdapter(db)
  const socketFactory = opts?.socketFactory || new WebSocketWebFactory()

  const client = await baseElectrify(
    dbName,
    dbDescription,
    adapter,
    socketFactory,
    config,
    opts
  )

  return client
}
```

For more help / pointers, [let us know on Discord](https://discord.electric-sql.com) and we'll be happy to help you with the integration.
