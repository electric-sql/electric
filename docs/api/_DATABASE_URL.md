Postgres connection string. Used to connect to the Postgres database.

The connection string must be in the [libpg Connection URI format](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-CONNSTRING-URIS) of `postgresql://[userspec@][hostspec][/dbname][?sslmode=<sslmode>]`.

The `userspec` section of the connection string specifies the database user that Electric connects to Postgres as. The permissions required for this user depend on your choice of [write-to-PG-mode](#write-to-pg-mode). See the [database user permissions](#database-user-permissions) section below for more information.

The optional `sslmode` query parameter may be set to one of the following values:

- `disable`
- `allow`
- `prefer`
- `require`

Including `sslmode=require` in the database connection string is equivalent to setting `DATABASE_REQUIRE_SSL=true` (which also happens to be the default). Any other value for `sslmode` is equivalent to setting `DATABASE_REQUIRE_SSL=false`. Do note that if you explicitly set `DATABASE_REQUIRE_SSL`, the `sslmode` query parameter in `DATABASE_URL` will be ignored.
