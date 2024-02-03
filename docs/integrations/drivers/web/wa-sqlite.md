---
title: wa-sqlite
---

ElectricSQL supports running in the web browser using [wa-sqlite](https://github.com/rhashimoto/wa-sqlite).

wa-sqlite is a WebAssembly build of SQLite that supports in-browser persistence using [IndexedDB](https://github.com/rhashimoto/wa-sqlite/blob/master/src/examples/IDBMinimalVFS.js) and the [Origin Private File System](https://github.com/rhashimoto/wa-sqlite/blob/master/src/examples/OriginPrivateFileSystemVFS.js).

You can use any configuration of wa-sqlite that you like. However, the instructions below are for the IndexedDB mode.

## Dependencies

Add `wa-sqlite` as a dependency to your app, e.g.:

```shell
npm install rhashimoto/wa-sqlite
```

Copy the WASM files into your app's public folder, e.g.:

```shell
cp ./node_modules/wa-sqlite/dist/wa-sqlite-async.* ./static
```

See the [wa-sqlite repo](https://github.com/rhashimoto/wa-sqlite) for more information.

## Usage

```tsx
import { electrify, ElectricDatabase } from 'electric-sql/wa-sqlite'

// Import your generated database schema.
import { schema } from './generated/client'

// Define your config with at least an auth token.
// See Usage -> Authentication for more details.
const config = {
  auth: {
    token: '...'
  }
}

// Create the wa-sqlite database connection. The first argument
// is your database name. Changing this will create/use a new
// local database file. The second argument is the public URL
// path to use when loading the wa-sqlite WASM files.
const conn = await ElectricDatabase.init('electric.db', '')

// Instantiate your electric client.
const electric = await electrify(conn, schema, config)
```

You can now use the client to read, write and sync data, e.g.:

```tsx
const { db } = electric

const results = db.projects.findMany()
console.log(results)
```

See the [examples/web-wa-sqlite](https://github.com/electric-sql/electric/tree/main/examples/web-wa-sqlite) demo app, <DocPageLink path="usage/data-access" /> and <DocPageLink path="integrations/frontend" /> for more information.
