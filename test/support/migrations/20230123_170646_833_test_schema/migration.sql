/*
ElectricSQL Migration
name: 20230123_170646_833_test_schema
title: test schema

When you build or sync these migrations we will add some triggers and metadata
so that ElectricSQL's Satellite component can sync your data.

Write your SQLite migration below.
*/
CREATE TABLE IF NOT EXISTS items (
  value TEXT PRIMARY KEY NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS parent (
  id INTEGER PRIMARY KEY NOT NULL,
  value TEXT,
  other INTEGER DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS child (
  id INTEGER PRIMARY KEY NOT NULL,
  parent INTEGER NOT NULL,
  FOREIGN KEY(parent) REFERENCES parent(id)
) WITHOUT ROWID;
