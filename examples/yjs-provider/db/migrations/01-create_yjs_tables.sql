CREATE TABLE ydoc_operations(
  id SERIAL PRIMARY KEY,
  room TEXT,
  op TEXT NOT NULL 
);

CREATE TABLE ydoc_awareness(
  client TEXT, 
  room TEXT,
  op TEXT NOT NULL,
  updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client, room)
);

CREATE OR REPLACE FUNCTION delete_old_rows()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM ydoc_awareness
    WHERE updated < NOW() - INTERVAL '2 minutes';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER delete_old_rows_trigger
AFTER INSERT OR UPDATE ON ydoc_awareness
FOR EACH STATEMENT
EXECUTE FUNCTION delete_old_rows();
