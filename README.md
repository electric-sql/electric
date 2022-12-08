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

![GitHub](https://img.shields.io/github/license/electric-sql/typescript-client) ![npm](https://img.shields.io/npm/v/electric-sql) [![Tests](https://github.com/electric-sql/typescript-client/actions/workflows/tests.yml/badge.svg?event=push)](https://github.com/electric-sql/typescript-client/actions/workflows/tests.yml)

# ElectricSQL Typescript Client

[ElectricSQL](https://electric-sql.com) is a local-first SQL system. It provides active-active cloud sync for embedded SQLite databases and a reactive programming model to bind components to live database queries.

The ElectricSQL Typescript Client is the main ElectricSQL client library for developing node, web and JavaScript-based mobile applications. It's designed to work with *any* SQLite driver or bindings, with convienience functions to integrate with the most popular ones, including the primary drivers for [Cordova](https://electric-sql.com/docs/usage/drivers#cordova), [Expo](https://electric-sql.com/docs/usage/drivers#expo), [React Native](https://electric-sql.com/docs/usage/drivers#react-native), [SQL.js](https://electric-sql.com/docs/drivers/web) (with [absurd-sql](https://electric-sql.com/docs/usage/web)), [Node.js](https://electric-sql.com/docs/usage/drivers#edge) (via [better-sqlite3](https://electric-sql.com/docs/usage/drivers#node)), [TypeORM](https://electric-sql.com/docs/usage/frameworks#typeorm) and [Prisma](https://electric-sql.com/docs/usage/frameworks#prisma).

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

The general principle is that you instantiate and use your SQLite driver as normal and call `electrify` when opening a new database connection. For example using `react-native-sqlite-storage`:

```js
import { electrify } from 'electric-sql/react-native'

// Import your SQLite driver.
import SQLite from 'react-native-sqlite-storage'
SQLite.enablePromise(true)

// Open a database connection and electrify it.
SQLite.openDatabase('example.db')
  .then(db => electrify(db, { app: "my-app", env: "prod", token: "token", migrations: [] }))
  .then(db => { // Use as normal, e.g.:
    db.transaction(tx => tx.executeSql('SELECT 1'))
  })
```

### Browser

Electric uses [SQL.js](https://electric-sql.com/docs/usage/web) in the browser with [absurd-sql](https://electric-sql.com/docs/usage/web) for persistence. This runs in a web worker (which we also use to keep background replication off the main thread). As a result, the electrified db client provides an asynchronous version of a subset of the SQL.js driver interface.

First create a `worker.js` file that imports and starts an ElectricWorker process:

```js
// worker.js
import { ElectricWorker } from 'electric-sql/browser'

ElectricWorker.start(self)
```

Then, in your main application:

```js
import { initElectricSqlJs } from 'electric-sql/browser'

// Start the background worker.
const url = new URL('./worker.js', import.meta.url)
const worker = new Worker(url, {type: "module"})

// Electrify the SQL.js / absurd-sql machinery and then open
// a persistent, named database.
initElectricSqlJs(worker, {locateFile: file => `/${file}`})
  .then(SQL => SQL.openDatabase('example.db', { app: "my-app", env: "prod", token: "token", migrations: [] }))
  .then(db => db.exec('SELECT 1'))
```

This gives you persistent, local-first SQL with active-active replication
in your web browser 🤯. Use the db client as normal, with the proviso that
the methods are now async (they return promises rather than direct values).

Note that the path to the worker.js must be relative and the worker.js file
must survive any build / bundling process. This is handled automatically by
most bundlers, including Esbuild (as of [#2508](https://github.com/evanw/esbuild/pull/2508)), Rollup and Webpack.

See the [usage documentation](https://electric-sql.com/docs/guides/usage) for:

- [target environment and driver specific instructions](https://electric-sql.com/docs/usage/drivers)
- [generic instructions for integrating *any* driver](https://electric-sql.com/docs/usage/drivers#generic)

### Reactivity

Once electrified, you can bind database queries to your reactive components, so they automatically re-query and (if necessary) re-render when the underlying data changes.

For example, again using React Native as an example, configure an electrified database provider at the root of your component hierarchy:

```js
// App.js
import React, { useEffect, useState } from 'react'

import { ElectricProvider } from 'electric-sql/react'

export default const App = () => {
  const [db, setDb] = useState(null)

  useEffect(() => {
    SQLite.openDatabase('example.db')
      .then(db => electrify(db, { app: "my-app", env: "prod", token: "token" }))
      .then(db => setDb(db))
  }, [])

  if (!db) { 
    return null
  }

  return (
    <ElectricProvider db={ db }>
      {/* ... your component hierarchy here */}
    </ElectricProvider>
  )
}
````

You can then bind query results to your reactive component using the [useElectricQuery](https://github.com/electric-sql/typescript-client/blob/main/src/frameworks/react/hooks.ts) hook:

```js
// MyComponent.js
import React from 'react'
import { Pressable, Text, View } from 'react-native'

import { useElectric, useElectricQuery } from 'electric-sql/react'

export const MyComponent = () => {
  // Query `results` are kept in sync automatically.
  const { results } = useElectricQuery('SELECT value FROM items')

  // Writes are made using standard SQL.
  const [ sql ] = useElectric()
  const addItem = () => sql.execute('INSERT INTO items VALUES(?)', [`${Date.now()}`])

  return (
    <View>
      {results.map((item, index) => (
        <Text key={index}>
          Item: {item.value}
        </Text>
      ))}

      <Pressable onPress={addItem}>
        <Text>Add</Text>
      </Pressable>
    </View>
  )
}
```

See the [frameworks guide](https://electric-sql.com/docs/usage/frameworks) for more information.

## Issues

Please raise any bugs, issues and feature requests on [GitHub Issues](https://github.com/electric-sql/typescript-client/issues).

## Contributing

See the [Community Guidelines](https://github.com/electric-sql/meta) including the [Guide to Contributing](https://github.com/electric-sql/meta/blob/main/CONTRIBUTING.md) and [Contributor License Agreement](https://github.com/electric-sql/meta/blob/main/CLA.md).

## Support

We have an [open community Discord](https://discord.gg/B7kHGwDcbj). If you’re interested in the project, please come and say hello and let us know if you have any questions or need any help or support getting things running.
