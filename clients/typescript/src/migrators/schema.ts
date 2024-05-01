import { satelliteDefaults } from '../satellite/config'
import { QueryBuilder } from './query-builder'

export const buildInitialMigration = (builder: QueryBuilder) => {
  const { metaTable, migrationsTable, oplogTable, triggersTable, shadowTable } =
    satelliteDefaults(builder.defaultNamespace)
  const data = {
    migrations: [
      {
        statements: [
          //`-- The ops log table\n`,
          `CREATE TABLE IF NOT EXISTS ${oplogTable} (\n  "rowid" ${builder.AUTOINCREMENT_PK},\n  "namespace" TEXT NOT NULL,\n  "tablename" TEXT NOT NULL,\n  "optype" TEXT NOT NULL,\n  "primaryKey" TEXT NOT NULL,\n  "newRow" TEXT,\n  "oldRow" TEXT,\n  "timestamp" TEXT,  "clearTags" TEXT DEFAULT '[]' NOT NULL\n);`,
          // Add an index for the oplog
          builder.createIndex('_electric_table_pk_reference', oplogTable, [
            'namespace',
            'tablename',
            'primaryKey',
          ]),
          builder.createIndex('_electric_timestamp', oplogTable, ['timestamp']),
          //`-- Somewhere to keep our metadata\n`,
          `CREATE TABLE IF NOT EXISTS ${metaTable} (\n  "key" TEXT PRIMARY KEY,\n  "value" ${builder.BLOB}\n);`,
          //`-- Somewhere to track migrations\n`,
          `CREATE TABLE IF NOT EXISTS ${migrationsTable} (\n  "id" ${builder.AUTOINCREMENT_PK},\n  "version" TEXT NOT NULL UNIQUE,\n  "applied_at" TEXT NOT NULL\n);`,
          //`-- Initialisation of the metadata table\n`,
          `INSERT INTO ${metaTable} (key, value) VALUES ('compensations', 1), ('lsn', ''), ('clientId', ''), ('subscriptions', ''), ('seenAdditionalData', '');`,
          //`-- These are toggles for turning the triggers on and off\n`,
          `DROP TABLE IF EXISTS ${triggersTable};`,
          `CREATE TABLE ${triggersTable} ("namespace" TEXT, "tablename" TEXT, "flag" INTEGER, PRIMARY KEY ("namespace", "tablename"));`,
          //`-- Somewhere to keep dependency tracking information\n`,
          `CREATE TABLE "${shadowTable.namespace}"."${
            shadowTable.tablename
          }" (\n ${builder.pgOnly(
            '"rowid" SERIAL,'
          )} "namespace" TEXT NOT NULL,\n  "tablename" TEXT NOT NULL,\n  "primaryKey" TEXT NOT NULL,\n  "tags" TEXT NOT NULL,\n  PRIMARY KEY ("namespace", "tablename", "primaryKey"));`,
        ],
        version: '0',
      },
    ],
  }
  return data
}
