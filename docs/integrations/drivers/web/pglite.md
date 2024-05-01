---
title: PGlite
---

ElectricSQL supports running in the web browser using [PGlite](https://github.com/electric-sql/pglite/), our lightweight WebAssembly build of Postgres that supports in-browser persistence using IndexedDB.

## Dependencies

Add `@electric-sql/pglite` as a dependency to your app, e.g.:

```shell
npm install @electric-sql/pglite
```

See the [PGlite repo](https://github.com/electric-sql/pglite/) for more information.

## Usage

```tsx
import { electrify } from 'electric-sql/pglite'
import { PGlite } from '@electric-sql/pglite'

// Import your generated database schema.
import { schema } from './generated/client'

// Define custom configuration if needed
const config = {
  url: 'https://example.com:5133'
}

// Create the PGlite database connection. The first argument
// is your database name. Changing this will create/use a new
// local database file.
// PGlite uses a `idb://` prefix to specify that the database
// is stored in indexedDB.
const conn = new PGlite('idb://electric.db', {
  // You can optionally use the relaxed durability mode to 
  // improve responsiveness.
  // This schedules flush to indexedDB for after a query has
  // returned.
  relaxedDurability: true,
})

// Instantiate your electric client.
const electric = await electrify(conn, schema, config)

// Connect to the sync service, passing along your authentication token
// See Usage -> Authentication for more details.
await electric.connect('your token')
```

You can now use the client to read, write and sync data, e.g.:

```tsx
const { db } = electric

const results = await db.projects.findMany()
console.log(results)
```

See the [examples/web-wa-sqlite](https://github.com/electric-sql/electric/tree/main/examples/web-wa-sqlite) demo app, <DocPageLink path="usage/data-access" /> and <DocPageLink path="integrations/frontend" /> for more information.
