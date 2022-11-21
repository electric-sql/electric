#!/bin/bash
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" "dbname=$POSTGRES_DB replication=database" <<-EOSQL
  CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

  CREATE SCHEMA electric;
  CREATE TABLE electric.migrations (
    id SERIAL PRIMARY KEY,
    version VARCHAR(64) NOT NULL,
    hash VARCHAR(64) NOT NULL,
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(version)
  );

  INSERT INTO electric.migrations (version, hash) VALUES ('1', 'initial');

  CREATE PUBLICATION all_tables FOR ALL TABLES;
  CREATE_REPLICATION_SLOT all_changes LOGICAL pgoutput NOEXPORT_SNAPSHOT;
EOSQL
