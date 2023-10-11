---
title: Expo
sidebar_position: 10
---

ElectricSQL supports [Expo](https://expo.dev) via [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/).

## Dependencies

Add `expo-sqlite` as a dependency to your app, e.g.:

```shell
npx expo install expo-sqlite
```

See the [expo-sql docs](https://docs.expo.dev/versions/latest/sdk/sqlite/) for more information.

## Usage

```tsx
import * as SQLite from 'expo-sqlite'
import { electrify } from 'electric-sql/expo'

// Import your generated database schema.
import { schema } from './generated/client'

// Define your config with at least an auth token.
// See Usage -> Authentication for more details.
const config = {
  auth: {
    token: '...'
  }
}

// Create the expo-sqlite database connection. The first argument
// is your database name. Changing this will create/use a new
// local database file.
const conn = SQLite.openDatabase('electric.db')

// Instantiate your electric client.
const electric = await electrify(conn, schema, config)
```

You can now use the client to read, write and sync data, e.g.:

```tsx
const { db } = electric

const results = db.projects.findMany()
console.log(results)
```

See <DocPageLink path="usage/data-access" /> and <DocPageLink path="integrations/frontend" /> for more information.
