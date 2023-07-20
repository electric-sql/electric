# electric-sql

## 0.5.0-next.2

### Patch Changes

- bd02d79: Fixed garbage collection on shape unsubscribe (also called on subscription errors), which caused the DELETEs performed by GC get noted in operations log and sent to the server, causing data loss
- 49cbe27: Fixed using `.sync()` calls before the replication is established. Now we defer trying to subscribe until the replication is succesfully established if we're already in the process of connecting and starting.
- 2e8bfdf: Fixed the client not being able to reconnect if the migrations were preloaded and the only operation was a subscription. In that case the client have never received any LSNs (because migrations didn't need to be sent), so reconnection yielded errors due to missing LSN but existing previously fulfilled subscriptions. We now send the LSN with the subscription data so even if it's the first and only received message, the client has enough information to proceed.
- 93d7059: Fixed calls to the `.sync()` function when page reloads establishing a new subscription alongside existing one. Now we deduplicate subscription requests by hash of their contents, so no two exactly the same subscriptions are possible. This also solves calling `<table>.sync()` many times in multiple components - they will return the same promise.

## 0.5.0-next.1

### Patch Changes

- 49c4b35: Allowed `https:` protocol in service connections for CLI
- 525c8d1: Moved CLI dependency from dev to prod dependency list

## 0.5.0-next.0

### Minor Changes

- 69d13c4: Large rewrite, that introduces Data Access Library, client-side migration application, and subscriptions.

  This release encompasses quite a bit of work, but this is still considered an unstable release and so this is only a minor version bump.
  We intend to keep this and the `components/electric` server sync layer somewhat in sync on minor versions up to `1.0.0`: new features that require both server-side support as well as client-side support are going to result in a minor-level version bump on both, while features/improvements that don't need both sides will be marked as a patch version.

  Data access library exposes a prisma-like interface to interact with SQLite (any platform works, including web). On top of that, we introduce a `.sync()` interface which establishes a subscription with the server to get initial data and changes for the tables we're interested in.

  Server now knows how to send migrations to the clients as soon as they get applied to the underlying PostgreSQL database, and this client version applies them to the local database.

  Server now knows how to handle subscriptions and reconnection a bit better, which the client makes use of (in particular, this heavily improves initial sync performance).
