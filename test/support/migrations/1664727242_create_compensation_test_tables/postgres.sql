/*
ElectricDB Migration
{"metadata": {"title": "create_compensation_test_tables", "name": "1664727242_create_compensation_test_tables", "sha256": "fda9c8a1f86d0c67eec25b1b111c601ee505c1b9eafc32069ce40de4a2d83506"}}
*/

CREATE TABLE main.child (
  id integer PRIMARY KEY,
  parent integer NOT NULL,
  FOREIGN KEY(parent) REFERENCES parent(id) MATCH SIMPLE);

CREATE TABLE main.parent (
  id integer PRIMARY KEY,
  value text,
  otherValue integer DEFAULT 0);
