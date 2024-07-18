-- Create a simple items table.
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY NOT NULL
);

-- Populate the table with 10 items.
-- FIXME: Remove this once writing out of band is implemented
WITH generate_series AS (
    SELECT gen_random_uuid()::text AS id
    FROM generate_series(1, 10)
)
INSERT INTO items (id)
SELECT id
FROM generate_series;
