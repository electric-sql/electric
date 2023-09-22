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
BEGIN;
SELECT electric.migration_version('20230920_114900');
-- Create a simple items table.
CREATE TABLE IF NOT EXISTS items (
  value TEXT PRIMARY KEY NOT NULL
);

-- ⚡
-- Electrify the items table
CALL electric.electrify('items');
COMMIT;
