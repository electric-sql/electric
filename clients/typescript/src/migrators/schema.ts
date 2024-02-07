import { satelliteDefaults } from '../satellite/config'
import { QualifiedTablename } from '../util'
export type { ElectricSchema } from '../satellite/config'

const { metaTable, migrationsTable, oplogTable, triggersTable, shadowTable } =
  satelliteDefaults

export const getData = (dialect: 'SQLite' | 'PG') => {
  const pgOnly = (query: string) => {
    if (dialect === 'PG') {
      return query
    }
    return ''
  }
  const pgOnlyQuery = (query: string) => {
    if (dialect === 'PG') {
      return [query]
    }
    return []
  }

  const AUTOINCREMENT_PK =
    dialect === 'SQLite'
      ? 'INTEGER PRIMARY KEY AUTOINCREMENT'
      : 'SERIAL PRIMARY KEY'
  const BLOB = dialect === 'SQLite' ? 'BLOB' : 'TEXT'
  const create_index = (
    indexName: string,
    onTable: QualifiedTablename,
    columns: string[]
  ) => {
    const namespace = onTable.namespace
    const tablename = onTable.tablename
    if (dialect === 'SQLite') {
      return `CREATE INDEX IF NOT EXISTS ${namespace}.${indexName} ON ${tablename} (${columns.join(
        ', '
      )})`
    }
    return `CREATE INDEX IF NOT EXISTS ${indexName} ON ${namespace}.${tablename} (${columns.join(
      ', '
    )})`
  }

  const data = {
    migrations: [
      {
        statements: [
          // The main schema,
          ...pgOnlyQuery(`CREATE SCHEMA IF NOT EXISTS "main"`),
          //`-- The ops log table\n`,
          `CREATE TABLE IF NOT EXISTS ${oplogTable} (\n  rowid ${AUTOINCREMENT_PK},\n  namespace TEXT NOT NULL,\n  tablename TEXT NOT NULL,\n  optype TEXT NOT NULL,\n  primaryKey TEXT NOT NULL,\n  newRow TEXT,\n  oldRow TEXT,\n  timestamp TEXT,  clearTags TEXT DEFAULT '[]' NOT NULL\n);`,
          // Add an index for the oplog
          create_index('_electric_table_pk_reference', oplogTable, [
            'namespace',
            'tablename',
            'primaryKey',
          ]),
          create_index('_electric_timestamp', oplogTable, ['timestamp']),
          //`-- Somewhere to keep our metadata\n`,
          `CREATE TABLE IF NOT EXISTS ${metaTable} (\n  key TEXT PRIMARY KEY,\n  value ${BLOB}\n);`,
          //`-- Somewhere to track migrations\n`,
          `CREATE TABLE IF NOT EXISTS ${migrationsTable} (\n  id ${AUTOINCREMENT_PK},\n  version TEXT NOT NULL UNIQUE,\n  applied_at TEXT NOT NULL\n);`,
          //`-- Initialisation of the metadata table\n`,
          `INSERT INTO ${metaTable} (key, value) VALUES ('compensations', 1), ('lsn', ''), ('clientId', ''), ('subscriptions', '');`,
          //`-- These are toggles for turning the triggers on and off\n`,
          `DROP TABLE IF EXISTS ${triggersTable};`,
          `CREATE TABLE ${triggersTable} (tablename TEXT PRIMARY KEY, flag INTEGER);`,
          //`-- Somewhere to keep dependency tracking information\n`,
          `CREATE TABLE ${shadowTable} (\n ${pgOnly(
            'rowid SERIAL,'
          )} namespace TEXT NOT NULL,\n  tablename TEXT NOT NULL,\n  primaryKey TEXT NOT NULL,\n  tags TEXT NOT NULL,\n  PRIMARY KEY (namespace, tablename, primaryKey));`,
        ],
        version: '0',
      },
    ],
  }
  return data
}
