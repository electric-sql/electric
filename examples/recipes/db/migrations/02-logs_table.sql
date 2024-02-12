-- Create a simple logs table.
CREATE TABLE IF NOT EXISTS logs (
  id UUID PRIMARY KEY NOT NULL,
  -- can be a foreign key to a source table, to refine
  -- access to logs and who can view them
  source_id UUID NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  content TEXT NOT NULL
);

-- ⚡
-- Electrify the items table
ALTER TABLE logs ENABLE ELECTRIC;
