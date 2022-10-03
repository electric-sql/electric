/*
ElectricDB Migration
{"metadata": {"title": "create_items_table", "name": "1664714702_create_items_table"}}
*/

CREATE TABLE IF NOT EXISTS main.items (
  id TEXT PRIMARY KEY,
  value TEXT,
  otherValue INTEGER
) STRICT, WITHOUT ROWID;
