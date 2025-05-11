CREATE TABLE ydoc_update(
  id SERIAL PRIMARY KEY,
  room TEXT,
  update BYTEA NOT NULL 
);

CREATE TABLE ydoc_awareness(
  client_id TEXT, 
  room TEXT,
  update BYTEA NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_id, room)
);

CREATE OR REPLACE FUNCTION gc_awareness_timeouts()
RETURNS TRIGGER AS $$
BEGIN
    DELETE FROM ydoc_awareness
    WHERE updated_at < (CURRENT_TIMESTAMP - INTERVAL '30 seconds') AND room = NEW.room;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER gc_awareness_timeouts_trigger
AFTER INSERT OR UPDATE ON ydoc_awareness
FOR EACH ROW
EXECUTE FUNCTION gc_awareness_timeouts();
