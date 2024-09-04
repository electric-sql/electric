---
title: Electric v0.11 released with support for Postgres in the client
description: >-
  Version 0.11 of ElectricSQL. This is the first release with support for syncing to Postgres in the client.
excerpt: >-
  Version 0.11 of ElectricSQL. This is the first release with
  support for syncing to Postgres in the client.
authors: [samwillis]
image: /img/blog/electric-released-with-postgres-support/header.jpg
tags: [release]
outline: deep
post: true
---

Postgres is the world's most popular open source relational database. Traditionally it runs on the server and scales out using read replicas.

Thanks to [PGlite](https://github.com/electric-sql/pglite), our new lightweight WASM build of Postgres, Postgres now runs efficiently, with persistence, in the web browser and other client environments like Node, Bun and Deno. As of v0.11 just released today, ElectricSQL now supports syncing data between Postgres in the cloud and PGlite in the client.

This means that you can now build apps that have a partial replica of a Postgres database in process, with zero network latency, realtime reactivity and background sync. It means you can run Postgres in process, inside your scripts, your development environments, your edge workers and your web services. Just using `npm install`.

## Sync to Postgres, PGlite, or SQLite

Until now, Electric has exclusively used SQLite as the client database, however, we have long wanted to also support Postgres. We previously experimented with a proof of concept [Tauri AI app that had an embedded Postgres](/blog/2024/02/05/local-first-ai-with-tauri-postgres-pgvector-llama), but this was limited to desktop use only. This release builds further on that work, enabling the client to sync with a local Postgres database.

Postgres and SQLite are quite different databases: SQLite is small and simple to embed and distribute, but its type system and SQL dialect is quite different from Postgres. SQLite is weakly typed, and has a much narrower band of types available when compared to Postgres with its strong and broad type system. This has made it complex at times to support Postgres schemas with SQLite; we have to translate them and ensure that writes to SQLite are compatible with the upstream Postgres.

Postgres in the client support simplifies this problem and unlocks the potential to support all Postgres types in future, including any non-standard types provided via extensions. We still have a little work ahead of us to unlock this, but it will be coming soon.

To demonstrate Postgres on the client we have updated both our basic web example and Linearlite, a clone of [Linear](https://linear.app) developed using ElectricSQL, to optionally use PGlite. You can test these online at [basic-items-pg.electric-sql.com](https://basic-items-pg.electric-sql.com/) and [linear-lite-pg.electric-sql.com](https://linear-lite-pg.electric-sql.com/).

### Continued Support for SQLite

SQLite support is not going away - it's the most widely used and trusted  database in the world. It's estimated there are [over *one trillion* SQLite databases in active use](https://www.sqlite.org/mostdeployed.html). Being able to sync from Postgres on your server to SQLite on a user's device is a core part of our mission.

While this support for Postgres in the client unlocks use cases that may be difficult to support on SQLite, SQLite is always going to be a popular database for embedded applications due to being lightweight, universally trusted and ubiquitous.


### Introducing PGlite

Postgres is generally considered a server database, although with a long history of being embedded in desktop apps so that they can access all the capabilities of a fully featured database. However, distributing Postgres in some environments is complex, or has been impossible, until now. A Web Assembly build of Postgres unlocks using it as a client-side database both in the web browser and in mobile apps.

Previous WASM Postgres projects have packaged it within a full Linux VM in order to emulate the normal conditions where Postgres would be run. However, this results in significant overhead and an increased application size.

We've taken a different approach by using the "single user mode" built into Postgres. This enables running Postgres as a single process, and is usually used for bootstrapping and for recovery in a server environment. We have extended this mode with full support for the Postgres wire protocol, enabling parameterised queries and deserialization of Postgres types to their JavaScript counterparts.

To learn more, visit the [PGlite repo on GitHub](https://github.com/electric-sql/pglite).

## Improved reliability

Until now, restarting the sync service meant that every client that had previously connected to it had to clear its local data and fetch the latest snapshot from the server before it could resume transaction streaming. In this release we're introducing an improvement to the sync service that allows it to maintain replication stream continuity through restarts.

After a server restart (e.g. due to a version upgrade) clients that have been keeping up with the latest server state will be able to reconnect and resume streaming transactions without any hurdles. How much a client may be lagging behind the latest server state and still be able to resume its replication stream on reconnection is determined by two new configuration options: `ELECTRIC_RESUMABLE_WAL_WINDOW` and `ELECTRIC_TXN_CACHE_SIZE`.

Going forward, we'll be maintaining a sharp focus on reliability and performance improvements of Electric. Expect to see more updates like this in upcoming releases.

## Other updates in this release

Version 0.11 includes many other changes and bug fixes along with the support for Postgres as the local database, for a full list see the [release notes](/docs/reference/release_notes).

## Using Electric with Postgres and PGlite

Using Postgres or PGlite with Electric follows the same pattern you are used to with the SQLite drivers, internally the driver adapters indicate to the Electric client which SQL dialect they require. There is no further configuration required.

To use Electric with PGlite first add `@electric-sql/pglite` as a dependency to your project:

```sh
npm install @electric-sql/pglite
```

Then change your app code to import PGlite, create the database and electrify it:

```ts
// Import the PGlite database client.
import { PGlite } from '@electric-sql/pglite'

// Import the adapter to electrify PGlite from the ElectricSQL library.
import { electrify } from 'electric-sql/pglite'

// Import your generated database schema.
import { schema } from './generated/client'

// Create the PGlite database connection.
// In the browser use a `idb://` prefixed path to store your 
// database in IndexedDB.
// In Node use a path to a directory on the file system where 
// you would like the pgdata directory.
const conn = new PGlite('idb://electric.db', {
  // You can optionally use the relaxed durability mode to 
  // improve responsiveness.
  // This schedules a flush to indexedDB for after a query has
  // returned.
  relaxedDurability: true,
})

// Instantiate your Electric client.
const electric = await electrify(conn, schema, {
  url: 'https://example.com:5133'
})
```

Full details of the [PGlite adapter are available in the documentation](/docs/integrations/drivers/web/wa-sqlite).

Electric is also able to support any Postgres database when run in a Node environment via the [node-postgres project](https://node-postgres.com).

First, add node-postgres as a dependency to your project:

```sh
npm install pg
```

Then create a node postgres client and electrify it: 

```ts
// Import the node-postgres database client.
import pg from 'pg'

// Import the adapter to electrify node-postgres from the ElectricSQL library.
import { electrify } from 'electric-sql/node-postgres'

// Import your generated database schema.
import { schema } from './generated/client'

// Create the node-postgres database connection.
const conn = new pg.Client({
  // Connection configuration, see:
  // https://node-postgres.com/apis/client
})
await conn.connect()

// Instantiate your electric client.
const electric = await electrify(conn, schema, , {
  url: 'https://example.com:5133'
})
```

Full details of the [node-postgres adapter are available in the documentation](http://localhost:3000/docs/integrations/drivers/server/postgres).
