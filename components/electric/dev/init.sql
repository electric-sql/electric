-- This file is also evaluated when creating new databases within the same Postgres dev cluster in unit tests.
-- Hence the need to guard against the role already existing.
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_user WHERE usename = 'min_privilege') THEN
    CREATE ROLE min_privilege REPLICATION LOGIN PASSWORD 'password';
  END IF;
END $$;

CREATE SCHEMA electric;
GRANT CREATE, USAGE ON SCHEMA electric TO min_privilege;
--ALTER SCHEMA electric OWNER TO min_privilege;

CREATE PUBLICATION electric_publication;
ALTER PUBLICATION electric_publication OWNER TO min_privilege;
