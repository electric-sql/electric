---
"@core/electric": patch
---

Make some configuration option names more descriptive. Namely,

- rename `ELECTRIC_HOST` to `LOGICAL_PUBLISHER_HOST`
- rename `POSTGRES_REPLICATION_PORT` to `LOGICAL_PUBLISHER_PORT`
- rename `STATUS_PORT` to `HTTP_API_PORT`

The first two options together define the host:port pair that the PostgreSQL database will connect to
in order to start following Electric's logical replication stream that publishes inbound changes from all clients.

The `HTTP_API_PORT` option is now more aptly named since Electric exposes more than just the status endpoint
on that port.
