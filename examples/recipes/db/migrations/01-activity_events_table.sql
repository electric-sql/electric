-- Create a simple activity events table.
CREATE TABLE IF NOT EXISTS activity_events (
  id UUID PRIMARY KEY NOT NULL,
  -- user IDs can be foreign keys to user table to restrict
  -- access for both vieweing and marking as read
  -- e.g. source_user_id UUID NOT NULL REFERENCES users(id)
  source_user_id UUID NOT NULL,
  target_user_id UUID NOT NULL,
  activity_type TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  message TEXT NOT NULL,
  action TEXT,
  read_at TIMESTAMPTZ
);

-- ⚡ Electrify the table
ALTER TABLE activity_events ENABLE ELECTRIC;
