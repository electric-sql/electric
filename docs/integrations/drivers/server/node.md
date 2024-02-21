---
title: NodeJS
---

ElectricSQL supports [Node.js](https://nodejs.org) server application using the [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) driver.

## Dependencies

Add `better-sqlite3` as a dependency to your app, e.g.:

```shell
npm install better-sqlite3
```

## Usage

```tsx
import Database from 'better-sqlite3'
import { electrify } from 'electric-sql/node'

// Import your generated database schema.
import { schema } from './generated/client'

// Define custom configuration if needed
const config = {
  url: 'https://example.com:5133'
}

// Create the better-sqlite3 database connection. The first
// argument is your database name. Changing this will
// create/use a new local database file.
const conn = new Database('example.db')

// Follow the library recommendation to enable WAL mode to
// increase performance. As per:
// https://github.com/WiseLibs/better-sqlite3/blob/master/docs/performance.md
conn.pragma('journal_mode = WAL')

// Instantiate your electric client.
const electric = await electrify(conn, schema, config)

// Connect to Electric, passing along your authentication token
// See Usage -> Authentication for more details.
await electric.connect('your token')
```

You can now use the client to read, write and sync data, e.g.:

```tsx
const { db } = electric

const results = db.projects.findMany()
console.log(results)
```

See <DocPageLink path="usage/data-access" /> and <DocPageLink path="integrations/frontend" /> for more information.
