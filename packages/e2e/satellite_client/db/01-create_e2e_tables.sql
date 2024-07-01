/*
 * This migration file defines all the tables used by the e2e tests.
 * Use it to migrate a Postgres database and then generate the Electric client from it.
 */

CREATE TABLE "items" (
  "id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "content_text_null" TEXT,
  "content_text_null_default" TEXT,
  "intvalue_null" INTEGER,
  "intvalue_null_default" INTEGER,
  CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE items ENABLE ELECTRIC;

CREATE TABLE "other_items" (
  "id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "item_id" TEXT,
  CONSTRAINT "other_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items" ("id"),
  CONSTRAINT "other_items_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "other_items" ENABLE ELECTRIC;

CREATE TABLE "timestamps" (
  id TEXT NOT NULL PRIMARY KEY,
  "created_at" TIMESTAMP NOT NULL,
  "updated_at" TIMESTAMPTZ NOT NULL
);

ALTER TABLE "timestamps" ENABLE ELECTRIC;

CREATE TABLE "datetimes" (
  id TEXT NOT NULL PRIMARY KEY,
  d DATE NOT NULL,
  t TIME NOT NULL
);

ALTER TABLE "datetimes" ENABLE ELECTRIC;

CREATE TABLE "bools" (
  id TEXT NOT NULL PRIMARY KEY,
  b BOOLEAN
);

ALTER TABLE "bools" ENABLE ELECTRIC;

CREATE TABLE "uuids" (
  id UUID NOT NULL PRIMARY KEY
);

ALTER TABLE "uuids" ENABLE ELECTRIC;

CREATE TABLE "ints" (
  id TEXT NOT NULL PRIMARY KEY,
  i2 INT2,
  i4 INT4,
  i8 INT8
);

ALTER TABLE "ints" ENABLE ELECTRIC;

CREATE TABLE "floats" (
  id TEXT NOT NULL PRIMARY KEY,
  f4 FLOAT4,
  f8 FLOAT8
);

ALTER TABLE "floats" ENABLE ELECTRIC;

CREATE TABLE "jsons" (
  id TEXT NOT NULL PRIMARY KEY,
  jsb JSONB
);

ALTER TABLE "jsons" ENABLE ELECTRIC;

CREATE TYPE "Color" AS ENUM ('RED', 'GREEN', 'BLUE');

CREATE TABLE "enums" (
  id TEXT NOT NULL PRIMARY KEY,
  c "Color"
);

ALTER TABLE "enums" ENABLE ELECTRIC;

CREATE TABLE "blobs" (
  id TEXT NOT NULL PRIMARY KEY,
  blob BYTEA
);

ALTER TABLE "blobs" ENABLE ELECTRIC;