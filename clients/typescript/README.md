<a href="https://electric-sql.com">
  <picture>
    <source media="(prefers-color-scheme: dark)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-light-trans.svg"
    />
    <source media="(prefers-color-scheme: light)"
        srcset="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
    <img alt="ElectricSQL logo"
        src="https://raw.githubusercontent.com/electric-sql/meta/main/identity/ElectricSQL-logo-black.svg"
    />
  </picture>
</a>

![License](https://img.shields.io/github/license/electric-sql/electric) [![npm](https://img.shields.io/npm/v/electric-sql)](https://www.npmjs.com/package/electric-sql) [![Tests](https://github.com/electric-sql/electric/actions/workflows/clients_typescript_tests.yml/badge.svg?event=push)](https://github.com/electric-sql/electric/actions/workflows/clients_typescript_tests.yml)

# ElectricSQL Typescript Client

[ElectricSQL](https://electric-sql.com) is a local-first SQL system. It provides active-active cloud sync for embedded SQLite databases and a reactive programming model to bind components to live database queries.

The ElectricSQL Typescript Client is the main ElectricSQL client library for developing node, web and JavaScript-based mobile applications. It's designed to work with _any_ SQLite driver or bindings, with convienience functions to integrate with the most popular ones, including the primary drivers for [Expo](https://electric-sql.com/docs/usage/drivers#expo), [React Native](https://electric-sql.com/docs/usage/drivers#react-native), [SQL.js](https://electric-sql.com/docs/usage/drivers#web) and [Node.js](https://electric-sql.com/docs/usage/drivers#edge).

See the:

- [Documentation](https://electric-sql.com/docs)
- [Quickstart](https://electric-sql.com/docs/usage/quickstart)

## Install

Using yarn:

```sh
yarn add electric-sql
```

Or using npm:

```sh
npm install --save electric-sql
```

## Usage

Instantiate and use your SQLite driver as normal and call `electrify` when opening a new database connection. For example using `react-native-sqlite-storage`:

```ts
import { electrify } from 'electric-sql/react-native'

// Import your SQLite driver
import SQLite from 'react-native-sqlite-storage'
SQLite.enablePromise(true)

// Import your app config and migrations
import config from '.electric/@config'

// Open an SQLite database connection
const original = await SQLite.openDatabase('example.db')

// ⚡ Electrify it
const db = electrify(original, config)

// Use as normal, e.g.:
db.transaction((tx) => tx.executeSql('SELECT 1'))
```

### Using in the web browser

Electric uses [SQL.js](https://electric-sql.com/docs/usage/drivers#web) in the browser with [absurd-sql](https://electric-sql.com/docs/usage/drivers#web) for persistence. This runs in a web worker (which we also use to keep background replication off the main thread). As a result, the electrified db client provides an asynchronous version of a subset of the SQL.js driver interface.

First create a `worker.js` file that imports and starts an `ElectricWorker` process:

```ts
import { ElectricWorker } from 'electric-sql/browser'

ElectricWorker.start(self)
```

Then, in your main application:

```ts
import { initElectricSqlJs } from 'electric-sql/browser'

// Import your app config and migrations
import config from '.electric/@config'

// Start the background worker
const url = new URL('./worker.js', import.meta.url)
const worker = new Worker(url, { type: 'module' })

// Electrify the SQL.js / absurd-sql machinery
const SQL = await initElectricSqlJs(worker, {
  locateFile: (file) => `/${file}`,
})

// Open a named database connection
const db = await SQL.openDatabase('example.db', config)
```

This gives you persistent, local-first SQL with active-active replication
in your web browser 🤯. Use the db client as normal, with the proviso that
the methods are now async (they return promises rather than direct values).

See the [Quickstart](https://electric-sql.com/docs/usage/quickstart) guide for more information.

### Reactivity

Once electrified, you can bind live database queries to your reactive components, so they automatically update when data changes or comes in over the replication stream. For example:

```tsx
import React from 'react'
import { Pressable, Text, View } from 'react-native'

import { useElectric, useElectricQuery } from 'electric-sql/react'

export const LiveComponent = () => {
  const db = useElectric()
  const { results } = useElectricQuery('SELECT value FROM items')

  const addItem = () => {
    sql.execute('INSERT INTO items VALUES(?)', [crypto.randomUUID()])
  }

  return (
    <View>
      {results.map((item, index) => (
        <Text key={index}>Item: {item.value}</Text>
      ))}

      <Pressable onPress={addItem}>
        <Text>Add</Text>
      </Pressable>
    </View>
  )
}
```

See the [Reactivity](https://electric-sql.com/docs/usage/reactivity) guide for more information.

## Issues

Please raise any bugs, issues and feature requests on [GitHub Issues](https://github.com/electric-sql/electric/issues).

## Contributing

See the [Community Guidelines](https://github.com/electric-sql/meta) including the [Guide to Contributing](https://github.com/electric-sql/meta/blob/main/CONTRIBUTING.md) and [Contributor License Agreement](https://github.com/electric-sql/meta/blob/main/CLA.md).

## Support

We have an [open community Discord](https://discord.gg/B7kHGwDcbj). If you’re interested in the project, please come and say hello and let us know if you have any questions or need any help or support getting things running.
