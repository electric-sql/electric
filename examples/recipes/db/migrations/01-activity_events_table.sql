-- Create a simple activity events table.
CREATE TABLE IF NOT EXISTS activity_events (
  id UUID PRIMARY KEY NOT NULL,
  source TEXT NOT NULL,
  target TEXT NOT NULL,
  activity_type TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  message TEXT NOT NULL,
  action TEXT,
  read_at TIMESTAMPTZ
);

-- ⚡ Electrify the table
ALTER TABLE activity_events ENABLE ELECTRIC;
