## Real-time sync for Postgres

Electric is a read-path sync engine for Postgres that does partial replication.

Electric syncs data out of Postgres into local client applications. It implements partial replication using a primitive called a Shape that is a bit like a live query for syncing.

### Key differentiators to other sync engines

- syncs out of Postgres into local client applications (i.e.: it syncs over the public Internet into many clients, as opposed to just doing sync in the cloud or between database systems)
- implements partial replication, so apps can defined Shapes to sync just the data they need
- works with any Postgres (with logical replication enabled)
  - includes working well with common Postgres hosts like Supabase, Neon, etc.
- works with any data model, including extensions
- agnostic to the choice of
  - client -- works with any language/system that speaks HTTP and JSON
  - store -- sync into anything from an in-memory state variable to a local embedded database
  - writes -- Electric just does the read-path syncing, i.e.: syncing out of Postgres, into local apps; apps built on Electric can implement writes and write-path sync themselves using their existing API
- scales to millions of concurrent users with low, flat latency and memory use
- handles high data-throughput (more than Postgres can handle)

### Primary use cases

- syncing data from Postgres in the cloud into local web and mobile applications
- building fast, modern, collaborative software like Figma and Linear
- building AI applications with resilient token streaming and multi-user sessions
- replacing hot/slow/expensive data fetching and database queries with sync
- building live, real-time dashboards
- hydrating data into edge workers and agents
- maintaining live local working sets for local analytics and local AI