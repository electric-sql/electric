---
title: React Native
sidebar_position: 20
---

ElectricSQL supports [React Native](https://reactnative.dev) via the [react-native-sqlite-storage](https://github.com/andpor/react-native-sqlite-storage) driver.

## Dependencies

Add `react-native-sqlite-storage` as a dependency to your app, e.g.:

```shell
yarn add react-native-sqlite-storage
```

See the [react-native-sqlite-storage README](https://github.com/andpor/react-native-sqlite-storage#installation) for additional steps -- basically you need
to configure the native modules for your target environments.

## Usage

You can use react-native-sqlite-storage with or without the promise API enabled. The example below shows using it with promises enabled:

```tsx
import SQLite from 'react-native-sqlite-storage'
import { electrify } from 'electric-sql/react-native'

// Import your generated database schema.
import { schema } from './generated/client'

// Define your config with at least an auth token.
// See Usage -> Authentication for more details.
const config = {
  auth: {
    token: '...'
  }
}

// Enable the promise API. Note that we use the
// `promisesEnabled` flag again below to tell the
// driver adapter that we're using the promise API.
const promisesEnabled = true
SQLite.enablePromise(promisesEnabled)

// Create the react-native-sqlite-storage database
// connection. The first argument is your database
// name. Changing this will create/use a new local
// database file.
const conn = await SQLite.openDatabase('electric.db')

// Instantiate your electric client.
const electric = await electrify(conn, schema, promisesEnabled, config)
```

You can now use the client to read, write and sync data, e.g.:

```tsx
const { db } = electric

const results = db.projects.findMany()
console.log(results)
```

See <DocPageLink path="usage/data-access" /> and <DocPageLink path="integrations/frontend" /> for more information.
