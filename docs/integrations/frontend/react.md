---
title: React
description: >-
  The library for web and native user interfaces.
sidebar_position: 10
---

ElectricSQL integrates with React via a [Context provider](#electricprovider) and [Hooks](#hooks).

The context provider provides your Electric [Client](../../usage/data-access/client.md) to your components. The hooks are used to bind [live queries](../../usage/data-access/queries.md#live-queries) to your components and handle connectivity state. You can see both in action in the <DocPageLink path="examples/basic" />.

## Context

### `makeElectricContext`

In React, [Context](https://reactjs.org/docs/context.html) provides a way to pass data through the component tree without having to pass props down manually at every level. ElectricSQL provides a `makeElectricContext` function that constructs an `ElectricProvider` [Context.Provider](https://reactjs.org/docs/context.html#contextprovider) and `useElectric` hook:

```tsx
import { makeElectricContext } from 'electric-sql/react'
import { Electric } from './generated/client'

const { ElectricProvider, useElectric } = makeElectricContext<Electric>()
```

You typically call this once per app as part of your instantiation code. You then use the provider and hook in tandem to pass down and access the client in your components.

:::info
We provide this dynamic API rather than static `ElectricProvider` and `useElectric` imports in order to preserve the type information about your database structure. As you can see from the example above, the context is constructed using the `Electric` type argument, which is a generated type containing all of the information about your database structure. This then allows you to write type safe data access code.
:::

### `ElectricProvider`

`ElectricProvider` is a [Context.Provider](https://reactjs.org/docs/context.html#contextprovider) that accepts an Electric [Client](../../usage/data-access/client.md) as it's value. Use it to pass down your electrified Client instance to your components, e.g.:

```tsx
// wrapper.tsx
import React, { ReactNode, useEffect, useState } from 'react'
import { insecureAuthToken } from 'electric-sql/auth'
import { makeElectricContext } from 'electric-sql/react'
import { ElectricDatabase, electrify } from 'electric-sql/wa-sqlite'
import { Electric, schema } from './generated/client'

const { ElectricProvider, useElectric } = makeElectricContext<Electric>()

export const ElectricWrapper = ({ children }) => {
  const [ electric, setElectric ] = useState<Electric>()

  useEffect(() => {
    const isMounted = true

    const init = async () => {
      const config = {
        auth: {
          token: insecureAuthToken({user_id: 'dummy'})
        }
      }
      const conn = await ElectricDatabase.init('electric.db', '')
      const electric = await electrify(conn, schema, config)

      if (!isMounted) {
        return
      }

      setElectric(electric)
    }

    init()

    return () => {
      isMounted = false
    }
  }, [])

  if (electric === undefined) {
    return null
  }

  return (
    <ElectricProvider db={electric}>
      { children }
    </ElectricProvider>
  )
}
```

With an `ElectricProvider` in place, you can then access the `electric` client instance using the `useElectric` hook.

## Hooks

### `useElectric`

The `useElectric` hook returns the client instance registered with the `ElectricProvider`, e.g.:

```tsx
import React, { useState } from 'react'
import { useElectric } from './wrapper'

const ExampleComponent = () => {
  const { db } = useElectric()!
  const [ value, setValue ] = useState()

  const generate = async () => {
    const { newValue } = await db.raw({
      sql: 'select random() as newValue'
    })

    setValue(newValue)
  }

  return (
    <div>
      <p>
        {value}
      </p>
      <p>
        <a onClick={generate}>
          Generate ↺
        </a>
    </div>
  )
}
```

### `useLiveQuery`

`useLiveQuery` sets up a live query (aka a dynamic or reactive query). This takes query function returned by one of the `db.live*` methods and keeps the results in sync whenever the relevant data changes.

```tsx
import React from 'react'
import { useLiveQuery } from 'electric-sql/react'
import { useElectric } from './wrapper'

const Component = () => {
  const { db } = useElectric()!

  // Use the query builder API.
  const { results } = useLiveQuery(
    db.items.liveMany()
  )

  // Use the raw SQL API.
  const { results: countResults } = useLiveQuery(
    db.liveRaw({
      sql: 'select count(*) from items'
    })
  )

  const items: Item[] = results ?? []

  const count: number =
    countResults !== undefined
    ? countResults[0].count
    : items.length

  return (
    <div>
      <p>
        { count }
        { count === 1 ? 'item' : 'items' }
      </p>
      <ul>
        {items.map((item, index) => (
          <li key={ index }>
            Item: { item.value }
          </li>
        ))}
      </ul>
    </div>
  )
}
```

The full return value of the hook is:

```tsx
const { results, error, updatedAt } = useLiveQuery(runQuery)
```

With a signature of:

```tsx
import { LiveResultContext } from 'electric-sql/client/model/model'

export interface ResultData<T> {
  error?: unknown
  results?: T
  updatedAt?: Date
}

function successResult<T>(results: T): ResultData<T> {
  return {
    error: undefined,
    results: results,
    updatedAt: new Date(),
  }
}

function errorResult<T>(error: unknown): ResultData<T> {
  return {
    error: error,
    results: undefined,
    updatedAt: new Date(),
  }
}

function useLiveQuery<Res>(
  runQuery: LiveResultContext<Res>
): ResultData<Res>
```

Running the query successfully will assign a new array of rows to the `results` and `error` will be `undefined`. Or if the query errors, the error will be assigned to the `error` variable and `results` will be `undefined`. The `updatedAt` variable is a [Date](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date) instance set when the return value last changed. Which is either when the query is first run or whenever it's re-run following a data change event.

See the implementation in [frameworks/react/hooks.ts](https://github.com/electric-sql/electric/blob/main/clients/typescript/src/frameworks/react/hooks/useLiveQuery.ts) for more details.

#### Query dependencies

The live query is re-run:

1. when any of the data in any of the tables it depends on changes
2. when any of the query parameters change

By default, `useLiveQuery` detects query parameter changes by comparing an [ohash](https://github.com/unjs/ohash) of the whole query parameter object. So in this case, an hash of the `{where: {status: ...}}` object.

```tsx
const Component = () => {
  const [ status, setStatus ] = useState()

  const { results } = useLiveQuery(
    db.projects.liveMany({
      where: {
        status: status
      }
    })
  )

  // ...
}
```

With this API, the hash needs to be generated on every render cycle. This can be expensive. You can avoid this and optimise the comparison by passing an explicit dependency list as a second argument to `useLiveQuery`:

```tsx
const Component = ({ isActive }) => {
  const [ status, setStatus ] = useState()

  const { results } = useLiveQuery(
    () => db.projects.liveMany({
      where: {
        status: status
      }
    }),
    [status]
  )

  // ...
}
```

Note that with this usage, the first argument wraps the `db.projects.liveMany()` call in a function. The alternative signature is:

```tsx
function useLiveQuery<Res>(
  runQueryFn: () => LiveResultContext<Res>,
  dependencies: DependencyList
): ResultData<Res>
```

### `useConnectivityState`

`useConnectivityState` binds the current connectivity status of the Satellite replication process for the electrified database client to a state variable and provides a function to toggle it between connected and disconnected:

```tsx
import React from 'react'
import { useConnectivityState } from 'electric-sql/react'

const ConnectivityControl = () => {
  const { connectivityState, toggleConnectivityState } = useConnectivityState()

  return (
    <a onMouseDown={ toggleConnectivityState }>
      <span className="capitalize">
        { connectivityState }
      </span>
    </a>
  )
}
```
