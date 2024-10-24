CREATE TABLE IF NOT EXISTS items (
    id VARCHAR(36) PRIMARY KEY,
    counter INTEGER DEFAULT 0,
    created_at TIMESTAMP with time zone DEFAULT CURRENT_TIMESTAMP
);

DELETE FROM items WHERE id = '00000000-0000-0000-0000-000000000000';
INSERT INTO items (id, counter, created_at) VALUES ('00000000-0000-0000-0000-000000000000', 0, now());

CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS void AS
$$
BEGIN
    UPDATE items SET  counter = counter + 1, created_at = now();
END;
$$
LANGUAGE plpgsql;