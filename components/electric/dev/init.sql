CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE entries (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4 (),
  content varchar(64) NOT NULL,
  content_b varchar(64)
);

CREATE TABLE entries_default (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4 (),
  content varchar(64) NOT NULL,
  content_b varchar(64)
);

ALTER TABLE entries_default REPLICA IDENTITY DEFAULT;

CREATE TABLE entries_no (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4 (),
  content varchar(64) NOT NULL,
  content_b varchar(64)
);

ALTER TABLE entries_no REPLICA IDENTITY NOTHING;

CREATE SCHEMA electric;

CREATE TABLE electric.migrations (
  id serial PRIMARY KEY,
  version varchar(64) NOT NULL,
  hash VARCHAR(64) NOT NULL,
  applied_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (version)
);

ALTER TABLE entries REPLICA IDENTITY
  FULL;

INSERT INTO electric.migrations (version, hash)
  VALUES ('1', 'initial');

