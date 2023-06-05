/*
ElectricSQL Migration
name: 20230124_160958_566_create_todomvc_schema
title: create todoMVC schema

When you build or sync these migrations we will add some triggers and metadata
so that ElectricSQL's Satellite component can sync your data.

Write your SQLite migration below.
*/
CREATE TABLE "todolist" (
    "id" TEXT NOT NULL,
    "filter" TEXT,
    "editing" TEXT,
    PRIMARY KEY ("id")
) WITHOUT ROWID;

CREATE TABLE "todo" (
    "id" TEXT NOT NULL,
    "listid" TEXT,
    "text" TEXT,
    "completed" INTEGER DEFAULT 0 NOT NULL,
    PRIMARY KEY ("id")
) WITHOUT ROWID;
