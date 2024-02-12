-- Create a simple logs table.
CREATE TABLE IF NOT EXISTS logs (
  id UUID PRIMARY KEY NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  content TEXT NOT NULL
);

-- ⚡
-- Electrify the items table
ALTER TABLE logs ENABLE ELECTRIC;
