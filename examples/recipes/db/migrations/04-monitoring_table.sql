-- Create a monitoring table for generic numerical metrics.
CREATE TABLE IF NOT EXISTS monitoring (
  id UUID PRIMARY KEY NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL
);

-- ⚡ Electrify the table
ALTER TABLE monitoring ENABLE ELECTRIC;
