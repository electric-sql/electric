#!/usr/bin/env bash
set -ex

DB_URL="postgresql://postgres:password@postgres:5432/electric?sslmode=disable"

psql $DB_URL -c "CREATE TABLE public.users (id uuid PRIMARY KEY, name text NOT NULL, email text NOT NULL);"