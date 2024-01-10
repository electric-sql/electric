The mode to use when writing data from Electric to Postgres. The allowed values are: `logical_replication` and `direct_writes`.

In `logical_replication` mode, Electric provides a logical replication publisher service over TCP that speaks the [Logical Streaming Replication Protocol](https://www.postgresql.org/docs/current/protocol-logical-replication.html). Postgres connects to Electric and establishes a subscription to this. Writes are then streamed in and applied using logical replication.

In `direct_writes` mode, Electric writes data to Postgres using a standard interactive client connection. This avoids the need for Postgres to be able to connect to Electric and reduces the permissions required for the database user that Electric connects to Postgres as.