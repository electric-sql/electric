/* This is an example of an SQL DDL migration. It creates an `pixels` table and
 * then calls an `electric.electrify` procedure to expose the table to the
 * ElectricSQL replication machinery.
 *
 * Note that these statements are applied directly to the *Postgres* database.
 * Electric then handles keeping the local SQLite database schema in sync with
 * the electrified subset of your Postgres database schema.
 *
 * See https://electric-sql.com/docs/usage/data-modelling for more information.
 */

-- Create a simple pixels table.
CREATE TABLE IF NOT EXISTS pixels (
  coords TEXT PRIMARY KEY NOT NULL,
  color TEXT NOT NULL
);

-- Create a table to track the presence of users.
CREATE TABLE IF NOT EXISTS presence (
  id TEXT PRIMARY KEY NOT NULL,
  x TEXT NOT NULL,
  y TEXT NOT NULL,
  color TEXT NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL
);

-- ⚡
-- Electrify the tables
ALTER TABLE pixels ENABLE ELECTRIC;
ALTER TABLE presence ENABLE ELECTRIC;
