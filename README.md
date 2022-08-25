
... logos, badges ...

# Electric SQL Typescript Client

[Electric SQL](https://electric-sql.com) is a local-first SQL system. It provides active-active cloud sync for embedded SQLite databases and a reactive programming model to bind components to live database queries.

The Electric SQL Typescript Client is the main Electric SQL client library for developing node, web and JavaScript-based mobile applications. It's designed to work with *any* SQLite driver or bindings, with convienience functions to integrate with the most popular ones, including the primary drivers for [React Native](#docs), [Expo](#docs), [Cordova](#docs), [Capacitor](#docs), [SQL.js](#docs) (with [absurd-sql](#docs)), Node (both [node-sqlite3](#docs) and [better-sqlite3](#docs)), [TypeORM](#docs) and [Prisma](#docs).

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
import { electrify } from 'electric-sql'

// Instantiate your SQLite driver.
import SQLite from 'react-native-sqlite-storage'
SQLite.enablePromise(true)

// Open a database connection and electrify it.
SQLite.openDatabase('example.db')
  .then(db => electrify(db))
  .then(db => { // Use as normal, e.g.:
    db.transaction(tx => tx.executeSql('SELECT 1'))
  })
```

We also provide an `initElectricSqlJs` function to instantiate a persistent, electrified database in the browser, using [SQL.js](#docs) with [absurd-sql](#docs). This creates a database instance that provides the same API as the default SQL.js driver but actually bootstraps and communicates with a web worker process running absurd-sql in the background.

```js
// Use instead of the default `initSqlJs` from SQL.js.
import { initElectricSqlJs } from 'electric-sql/browser'

// Initialise a persistent, named, electrified SQL.js database.
initElectricSqlJs({locateFile: file => `/${file}`})
  .then(ElectricSQL => {
    const db = new ElectricSQL.Database('example.db')

    // Use as normal, e.g.:
    db.exec('SELECT 1')
  })
```

See the [usage documentation](https://electric-sql.com/docs/guides/usage) for:

- [target environment and driver specific instructions](https://electric-sql.com/docs/guides/usage#targets-and-drivers)
- [generic instructions for integrating *any* driver](https://electric-sql.com/docs/guides/client-usage#generic-drivers)

## Reactivity

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
      .then(db => electrify(db))
      .then(db => setDb(db))
  }, [])

  if (!db) { 
    return null
  }

  return (
    <ElectricProvider db={db}>
      {/* ... your component hierarchy here */}
    </ElectricProvider>
  )
}
````

You can then bind query results to your reactive component using the `useElectricQuery` hook:

```js
// MyComponent.js
import React from 'react'
import { Pressable, Text, View } from 'react-native'

import { useElectric, useElectricQuery } from 'electric-sql/react'

export const MyComponent = () => {
  // Query `results` are kept in sync automatically.
  const [ results ] = useElectricQuery('SELECT value FROM items')

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

See the [usage documentation](https://electric-sql.com/docs/guides/usage) for:

- [framework specific instructions](https://electric-sql.com/docs/guides/usage#reactive-queries)
- [generic instructions for wiring up your own reactive integrations](https://electric-sql.com/docs/guides/usage#generic-reactivity)

## Issues

Please raise any bugs, issues and feature requests on [GitHub Issues](https://github.com/vaxine-io/electric-sql-ts/issues).
