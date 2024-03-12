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

-- Create a simple chat room table.
CREATE TABLE IF NOT EXISTS chat_room (
  id UUID PRIMARY KEY NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  username TEXT NOT NULL,
  message TEXT NOT NULL
);

-- ⚡
-- Electrify the chat room table
ALTER TABLE chat_room ENABLE ELECTRIC;
