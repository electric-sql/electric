#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" "dbname=$POSTGRES_DB replication=database" <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

  CREATE TABLE entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    content VARCHAR(64) NOT NULL,
    content_b VARCHAR(64)
  );

  ALTER TABLE entries REPLICA IDENTITY FULL;

  CREATE PUBLICATION all_tables FOR ALL TABLES;
  CREATE_REPLICATION_SLOT all_changes LOGICAL pgoutput NOEXPORT_SNAPSHOT;
EOSQL
