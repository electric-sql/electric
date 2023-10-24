CREATE EXTENSION IF NOT EXISTS dblink;

CREATE SCHEMA IF NOT EXISTS electric;

CREATE OR REPLACE PROCEDURE electric.create_subscription(name TEXT, publication_name TEXT, connection_str TEXT)
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $body$
BEGIN
  EXECUTE format('CREATE SUBSCRIPTION %I CONNECTION %L PUBLICATION %I WITH (connect = false)',
                 name, connection_str, publication_name);
END
$body$;

CREATE OR REPLACE PROCEDURE electric.refresh_subscription(name TEXT)
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $body$
BEGIN
  -- Postgres does not allow executing `ALTER SUBSCRIPTION` inside a routine.
  -- This is a workaround that establishes a new connection to the same DB we're currently
  -- connected and executes `ALTER SUBSCRIPTION` as a top-level statement.
  --
  -- Source: https://www.postgresql.org/message-id/CAAc324hNuW-FqTnpXbsyA8FmocoGx7AcULiFE7yxmqiw2gKkfQ%40mail.gmail.com
  PERFORM dblink_exec(format('user=%L dbname=%L', current_user, current_database()),
                      format('ALTER SUBSCRIPTION %I REFRESH PUBLICATION WITH (copy_data = false)', name));
END;
$body$;

CREATE OR REPLACE PROCEDURE electric.enable_subscription(name TEXT)
LANGUAGE PLPGSQL
SECURITY DEFINER
AS $body$
BEGIN
  EXECUTE format('ALTER SUBSCRIPTION %I ENABLE', name);
END;
$body$;

-- This file is also evaluated when creating new databases within the same Postgres dev cluster in unit tests.
-- Hence the need to guard against the role already existing.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_user WHERE usename = 'min_privilege') THEN
    CREATE ROLE min_privilege REPLICATION LOGIN PASSWORD 'password';
  END IF;
END $$;

GRANT CREATE, USAGE ON SCHEMA electric TO min_privilege;
