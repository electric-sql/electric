/*
ElectricDB Migration
{"metadata": {"title": "test_schema", "name": "1666287449_test_schema"}}
*/
CREATE TABLE IF NOT EXISTS main.items (
  value TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS main.parent (
  id INTEGER PRIMARY KEY,
  value TEXT,
  otherValue INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS main.child (
  id INTEGER PRIMARY KEY,
  parent INTEGER NOT NULL,
  FOREIGN KEY(parent) REFERENCES parent(id)
);
