-- Create a simple chat room table.
CREATE TABLE IF NOT EXISTS chat_room (
  id UUID PRIMARY KEY NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  -- can have foreign key to users table
  -- user_id UUID NOT NULL REFERENCES users(id)
  username TEXT NOT NULL,
  message TEXT NOT NULL
);

-- ⚡ Electrify the table
ALTER TABLE chat_room ENABLE ELECTRIC;
