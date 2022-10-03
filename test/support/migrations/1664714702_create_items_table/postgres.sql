/*
ElectricDB Migration
{"metadata": {"title": "create_items_table", "name": "1664714702_create_items_table", "sha256": "e24043b5d46a8338ef5a76a4f332a47fd77de57ecbf7d8e6b0587acdc20eb370"}}
*/

CREATE TABLE main.items (
  id text PRIMARY KEY,
  value text,
  otherValue integer);
