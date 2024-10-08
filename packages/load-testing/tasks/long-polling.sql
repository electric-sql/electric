CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO items (id) VALUES ('00000000-0000-0000-0000-000000000000') ON CONFLICT (id) DO NOTHING;

-- Create function to update timestamp
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS void AS
$$
BEGIN
    UPDATE items SET created_at = now();
    -- You can add more SQL statements or logic here
END;
$$
LANGUAGE plpgsql;