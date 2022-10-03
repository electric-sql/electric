/*
ElectricDB Migration
{"metadata": {"title": "create_compensation_test_tables", "name": "1664727242_create_compensation_test_tables"}}
*/

CREATE TABLE IF NOT EXISTS main.parent (
  id INTEGER PRIMARY KEY,
  value TEXT,
  otherValue INTEGER DEFAULT 0
) STRICT, WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS main.child (
  id INTEGER PRIMARY KEY,
  parent INTEGER NOT NULL,
  FOREIGN KEY(parent) REFERENCES parent(id)
) STRICT, WITHOUT ROWID;
