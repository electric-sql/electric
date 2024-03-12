-- Create a monitoring table for generic numerical metrics.
CREATE TABLE IF NOT EXISTS monitoring (
  id UUID PRIMARY KEY NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  type TEXT NOT NULL, -- e.g. CPU, Memory, Disk, Network
  value DOUBLE PRECISION NOT NULL
);

-- Index for type and timestamp columns
CREATE INDEX monitoring_idx_type_timestamp ON monitoring(type, timestamp);

-- ⚡ Electrify the table
ALTER TABLE monitoring ENABLE ELECTRIC;
