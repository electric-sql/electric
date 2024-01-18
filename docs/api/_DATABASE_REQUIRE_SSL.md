Set to `false` to enable Electric to fallback to using unencrypted connections in case the database is not configured to work with SSL.

Be mindful of changing this default, more often than not it's a bad idea to use unencrypted database connections because all data flowing between your database and Electric may get intercepted by an unauthorized party.
