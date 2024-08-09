CREATE TABLE ydoc_updates(
  id uuid PRIMARY KEY,
  name TEXT,
  op TEXT NOT NULL 
);

CREATE TABLE ydoc_awareness(
  id SERIAL,
  client_id TEXT, 
  name TEXT,
  op TEXT NOT NULL,
  PRIMARY KEY (id, client_id, name)
);