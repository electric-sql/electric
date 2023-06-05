/*
ElectricSQL Migration
name: 20230123_194259_915_create_items
title: create items

When you build or sync these migrations we will add some triggers and metadata
so that ElectricSQL's Satellite component can sync your data.

Write your SQLite migration below.
*/
CREATE TABLE IF NOT EXISTS items (
  value TEXT PRIMARY KEY NOT NULL
) WITHOUT ROWID;
