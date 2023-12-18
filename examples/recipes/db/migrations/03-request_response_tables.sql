/* This is an example of an SQL DDL migration. It creates an `items` table and
 * then calls an `electric.electrify` procedure to expose the table to the
 * ElectricSQL replication machinery.
 *
 * Note that these statements are applied directly to the *Postgres* database.
 * Electric then handles keeping the local SQLite database schema in sync with
 * the electrified subset of your Postgres database schema.
 *
 * See https://electric-sql.com/docs/usage/data-modelling for more information.
 */

-- Create a requests table.
CREATE TABLE IF NOT EXISTS requests (
  id UUID PRIMARY KEY NOT NULL,
  path TEXT NOT NULL,
  method TEXT NOT NULL,
  data JSONB,
  processing BOOLEAN NOT NULL,
  cancelled BOOLEAN NOT NULL

);

CREATE TABLE IF NOT EXISTS responses (
  id UUID PRIMARY KEY NOT NULL,
  request_id UUID NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  status_code INTEGER NOT NULL,
  data JSONB
);

-- ⚡
-- Electrify the requests and responses table
ALTER TABLE requests ENABLE ELECTRIC;
ALTER TABLE responses ENABLE ELECTRIC;
