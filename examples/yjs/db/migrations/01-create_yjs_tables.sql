CREATE TABLE ydoc_operations(
  id SERIAL PRIMARY KEY,
  room TEXT,
  op BYTEA NOT NULL 
);

CREATE TABLE ydoc_awareness(
  client_id TEXT, 
  room TEXT,
  op BYTEA NOT NULL,
  updated TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, room)
);

CREATE OR REPLACE FUNCTION delete_old_rows()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM ydoc_awareness
    WHERE updated < (CURRENT_TIMESTAMP - INTERVAL '30 seconds') AND room = NEW.room;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER delete_old_rows_trigger
AFTER INSERT OR UPDATE ON ydoc_awareness
FOR EACH ROW
EXECUTE FUNCTION delete_old_rows();
