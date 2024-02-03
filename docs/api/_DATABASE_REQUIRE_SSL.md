Set to `false` to enable Electric to fallback to using unencrypted connections in case the database is not configured to work with SSL.

Be mindful of changing this default, more often than not it's a bad idea to use unencrypted database connections because all data flowing between your database and Electric may get intercepted by an unauthorized party.

Whether Electric will use SSL encryption for its database connections can also be configured with the `sslmode` query parameter in `DATABASE_URL` but only if `DATABASE_REQUIRE_SSL` is not explicitly set.
