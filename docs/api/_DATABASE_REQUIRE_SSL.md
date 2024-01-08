Set to `false` to not require SSL for the Postgres database connection.

Note that you can also configure the database connection's SSL mode using the `sslmode` [`DATABASE_URL` parameter](https://www.postgresql.org/docs/current/libpq-connect.html#LIBPQ-PARAMKEYWORDS). Values set in the `DATABASE_URL` have precedence.