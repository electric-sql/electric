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

-- Create a simple items table.
CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY,
  value TEXT NOT NULL,
  i int2,
  i8 bigint,
  r real,
  f float4,
  "Vc" varchar,
  "b-oo-lean" boolean not null
);

CREATE TABLE "_weird_Name" (
  id text primary key,
  item uuid references items(id),
  "foo bar" timestamptz
);

CREATE TYPE woods AS ENUM ('birch', 'mahogany', 'spruce', 'pine', 'oak');

CREATE TABLE "public.trees" (
  id uuid primary key,
  wood woods NOT NULL,
  " Knock on (-wood-)" boolean NOT NULL
);

-- ⚡
-- Electrify the items table
ALTER TABLE items ENABLE ELECTRIC;
ALTER TABLE "_weird_Name" ENABLE ELECTRIC;
ALTER TABLE "public.trees" ENABLE ELECTRIC;
