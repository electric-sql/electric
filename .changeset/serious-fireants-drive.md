---
"electric-sql": minor
---

Large rewrite, that introduces Data Access Library, client-side migration application, and subscriptions.

This release encompasses quite a bit of work, but this is still considered an unstable release and so this is only a minor version bump.
We intend to keep this and the `components/electric` server sync layer somewhat in sync on minor versions up to `1.0.0`: new features that require both server-side support as well as client-side support are going to result in a minor-level version bump on both, while features/improvements that don't need both sides will be marked as a patch version.

Data access library exposes a prisma-like interface to interact with SQLite (any platform works, including web). On top of that, we introduce a `.sync()` interface which establishes a subscription with the server to get initial data and changes for the tables we're interested in.

Server now knows how to send migrations to the clients as soon as they get applied to the underlying PostgreSQL database, and this client version applies them to the local database.

Server now knows how to handle subscriptions and reconnection a bit better, which the client makes use of (in particular, this heavily improves initial sync performance).
