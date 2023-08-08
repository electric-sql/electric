-- Create a simple items table.
CREATE TABLE items (
  value TEXT PRIMARY KEY NOT NULL
);

-- ⚡
-- Electrify the table
CALL electric.electrify('items');
