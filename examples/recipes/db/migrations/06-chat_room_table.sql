-- Create a simple chat room table.
CREATE TABLE IF NOT EXISTS chat_room (
  id UUID PRIMARY KEY NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  username TEXT NOT NULL,
  message TEXT NOT NULL
);

-- ⚡
-- Electrify the chat room table
ALTER TABLE chat_room ENABLE ELECTRIC;
