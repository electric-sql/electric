/* This is an example of an SQL DDL migration. It creates tables and
 * then calls an `electric.electrify` procedure to expose the tables to the
 * ElectricSQL replication machinery.
 *
 * Note that these statements are applied directly to the *Postgres* database.
 * Electric then handles keeping the local SQLite database schema in sync with
 * the electrified subset of your Postgres database schema.
 *
 * See https://electric-sql.com/docs/usage/data-modelling for more information.
 */

-- Create a monitoring table for generic numerical metrics.
CREATE TABLE IF NOT EXISTS monitoring (
  id UUID PRIMARY KEY NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL
);

-- ⚡
-- Electrify the table
ALTER TABLE monitoring ENABLE ELECTRIC;
