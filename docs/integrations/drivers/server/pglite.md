---
title: PGlite
---

ElectricSQL supports [Node.js](https://nodejs.org) server applications using [PGlite](https://github.com/electric-sql/pglite/), our lightweight WebAssembly build of Postgres.

## Dependencies

Add `@electric-sql/pglite` as a dependency to your app, e.g.:

```shell
npm install @electric-sql/pglite
```

See the [PGlite repo](https://github.com/electric-sql/pglite/) for more information.

## Usage

```tsx
// Import the PGlite database client.
import { electrify } from 'electric-sql/pglite'

// Import the adapter to electrify PGlite from the ElectricSQL library.
import { PGlite } from '@electric-sql/pglite'

// Import your generated database schema.
import { schema } from './generated/client'

// Define custom configuration if needed
const config = {
  url: 'https://example.com:5133'
}

// Create the PGlite database connection. The first argument
// is your Postgres `pgdata` directory. Changing this will 
// create/use a new local database.
const conn = new PGlite('/path/to/postgres/datadir')

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

See <DocPageLink path="usage/data-access" /> and <DocPageLink path="integrations/frontend" /> for more information.
