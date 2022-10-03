/*
ElectricDB Migration
{"metadata": {"title": "create_compensation_test_tables", "name": "1664727242_create_compensation_test_tables", "sha256": "91625cae6ed25314e26a00987f3e84c198540c4c83caf88f6a370ce8d7191159"}}
*/

CREATE TABLE main.child (
  id integer PRIMARY KEY,
  parent integer NOT NULL,
  FOREIGN KEY(parent) REFERENCES parent(id) MATCH SIMPLE);

CREATE TABLE main.parent (
  id integer PRIMARY KEY,
  value text,
  otherValue integer DEFAULT 0);
