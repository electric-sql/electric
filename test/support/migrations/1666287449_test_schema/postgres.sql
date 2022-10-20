/*
ElectricDB Migration
{"metadata": {"title": "test_schema", "name": "1666287449_test_schema", "sha256": "1f92fe49241a0f270bf61bfcbbe0e1b84f3727011d743ede4e7802c3c3289d81"}}
*/

CREATE TABLE main.child (
  id integer PRIMARY KEY,
  parent integer NOT NULL,
  FOREIGN KEY(parent) REFERENCES parent(id) MATCH SIMPLE);

CREATE TABLE main.items (
  value text PRIMARY KEY);

CREATE TABLE main.parent (
  id integer PRIMARY KEY,
  value text,
  otherValue integer DEFAULT 0);
