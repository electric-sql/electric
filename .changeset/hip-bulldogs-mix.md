---
"@core/electric": minor
---

Rewritten the Electric sync layer to remove Vaxine and enable partial replication

This release encompasses quite a bit of work, which resulted in a complete overhaul of the current system. It's hard to note all changes, see git history for that, but this public release
marks the first somewhat stable version of the system for which we intend incremental changes.

That said, this is still considered an unstable release and so this is only a minor version bump.
We intend to keep this and the `electric-sql` typescript library somewhat in sync on minor versions up to `1.0.0`: new features that require both server-side support as well as client-side support are going to result in a minor-level version bump on both, while features/improvements that don't need both sides will be marked as a patch version.

Rough change list between previous version and this one:
- Removed Antidote (Vaxine) from the system
- Moved CRDT conflict resolution into GitHub using special observed operations CRDT form
- Streamlined the deployment heavily by relying now on unpatched Postgres
- Removed the Postgres-to-Postgres replication
- Added the concept of "electrified" tables - only those can be synced to the client
- Added PG-managed migrations instead of relying on an external system (previously, our cloud console) to manage them
- Added migration propagation to the client so that the server may dictate table creation to the clients
- Heavily improved initial sync story: we don't send the entire Antidote write-ahead log on connect, we send actual data queried from Postgres and then start streaming the changes
- Added the first iteration of partial replication, where the client subscribes to tables they are interested in instead of the all available tables

