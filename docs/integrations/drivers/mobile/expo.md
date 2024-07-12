---
title: Expo
sidebar_position: 10
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

ElectricSQL supports [Expo](https://expo.dev) via both [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/) and [expo-sqlite (legacy)](https://docs.expo.dev/versions/latest/sdk/sqlite-legacy/).

## Dependencies

Add `expo-sqlite` as a dependency to your app, e.g.:

```shell
npx expo install expo-sqlite
```

This package includes both the regular and `next` drivers. See the [expo-sqlite docs](https://docs.expo.dev/versions/latest/sdk/sqlite/) or [expo-sqlite/next docs](https://docs.expo.dev/versions/latest/sdk/sqlite-next/) for more information.

import CryptoPolyfillWarning from './_crypto_polyfill_warning.md'

<CryptoPolyfillWarning />

## Usage

<Tabs groupId="usage" queryString>
<TabItem value="expo-sqlite" label="expo-sqlite">

```ts
import * as SQLite from 'expo-sqlite'
import { electrify } from 'electric-sql/expo'

// Create the expo-sqlite database connection. The first argument
// is your database name. Changing this will create/use a new
// local database file.
const conn = SQLite.openDatabase('electric.db')
```

</TabItem>

<TabItem value="expo-sqlite-next" label="expo-sqlite/next">

```ts
import * as SQLite from 'expo-sqlite/next'
import { electrify } from 'electric-sql/expo-next' 

// Create the expo-sqlite database connection. The first argument
// is your database name. Changing this will create/use a new
// local database file.
const conn = SQLite.openDatabaseSync('electric.db')
```

</TabItem>
</Tabs>

You can now instantiate an Electric client for the database connection and use it to read, write and sync data, e.g.:

```ts
// Import your generated database schema.
import { schema } from './generated/client'

// Define custom configuration if needed
const config = { url: 'https://example.com:5133' }

// Instantiate your electric client.
const electric = await electrify(conn, schema, config)

// Connect to Electric, passing along your authentication token
// See Usage -> Authentication for more details.
await electric.connect('your token')

const { db } = electric

const results = await db.projects.findMany()
console.log(results)
```

See <DocPageLink path="usage/data-access" /> and <DocPageLink path="integrations/frontend" /> for more information.
