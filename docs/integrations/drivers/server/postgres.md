---
title: node-postgres
---

ElectricSQL supports [Node.js](https://nodejs.org) server applications using the [node-postgres](https://node-postgres.com) driver.

## Dependencies

Add `pg` as a dependency to your app, e.g.:

```shell
npm install pg
```

## Usage

```tsx
// Import the node-postgres database client.
import pg from 'pg'

// Import the adapter to electrify node-postgres from the ElectricSQL library.
import { electrify } from '@electric-sql/node-postgres'

// Import your generated database schema.
import { schema } from './generated/client'

// Define custom configuration if needed
const config = {
  url: 'https://example.com:5133'
}

// Create the node-postgres database connection.
const conn = new pg.Client({
  // Connection configuration, see:
  // https://node-postgres.com/apis/client
})
await conn.connect()

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
