---
title: React Native
sidebar_position: 20
---

ElectricSQL supports [React Native](https://reactnative.dev) via the [@op-engineering/op-sqlite](https://github.com/OP-Engineering/op-sqlite) driver.

## Dependencies

Add `@op-engineering/op-sqlite` as a dependency to your app, e.g.:

```shell
npm install @op-engineering/op-sqlite
```

See the [op-sqlite documentation](https://ospfranco.notion.site/Installation-Flags-93044890aa3d4d14b6c525ba4ba8686f) for additional steps -- basically you might need
to configure the native modules for your target environments.

## Usage

The example below shows how to use the op-sqlite driver with Electric:

```tsx
import { open as openOPSQLiteConn } from '@op-engineering/op-sqlite'
import { electrify } from 'electric-sql/op-sqlite'

// Import your generated database schema.
import { schema } from './generated/client'

// Define custom configuration if needed
const config = {
  url: 'https://example.com:5133'
}

// Create the op-sqlite database connection.
// The `name` argument is your database file name.
// Changing this will create/use a new local database file.
const dbName = 'electric.db'
const conn = openOPSQLiteConn({ name: dbName })

// Instantiate your electric client.
const electric = await electrify(conn, dbName, schema, promisesEnabled, config)

// Connect to Electric, passing along your authentication token
// See Usage -> Authentication for more details.
await electric.connect('your token')
```

You can now use the client to read, write and sync data, e.g.:

```tsx
const { db } = electric

const results = await db.projects.findMany()
console.log(results)
```

See <DocPageLink path="usage/data-access" /> and <DocPageLink path="integrations/frontend" /> for more information.
