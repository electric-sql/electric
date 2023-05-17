/*
ElectricSQL Migration
name: 20230515_123048_572_init
title: init

When you build or sync these migrations we will add some triggers and metadata
so that ElectricSQL's Satellite component can sync your data.

Write your SQLite migration below.
*/

-- CreateTable
CREATE TABLE issue (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    priority TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL
) WITHOUT ROWID;