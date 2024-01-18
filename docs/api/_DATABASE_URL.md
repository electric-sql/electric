Postgres connection string. Used to connect to the Postgres database.

The connection string must be in the [libpg Connection URI format](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING-URIS) of `postgresql://[userspec@][hostspec][/dbname]`.

The `userspec` section of the connection string specifies the database user that Electric connects to Postgres as. The permissions required for this user depend on your choice of [write-to-PG-mode](#write-to-pg-mode). See the [database user permissions](#database-user-permissions) section below for more information.
