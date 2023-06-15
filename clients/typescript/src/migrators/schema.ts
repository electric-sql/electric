import { satelliteDefaults } from '../satellite/config'

const { metaTable, migrationsTable, oplogTable, triggersTable, shadowTable } =
  satelliteDefaults

export const data = {
  migrations: [
    {
      statements: [
        //`-- The ops log table\n`,
        `CREATE TABLE IF NOT EXISTS ${oplogTable} (\n  rowid INTEGER PRIMARY KEY AUTOINCREMENT,\n  namespace String NOT NULL,\n  tablename String NOT NULL,\n  optype String NOT NULL,\n  primaryKey String NOT NULL,\n  newRow String,\n  oldRow String,\n  timestamp TEXT,  clearTags TEXT DEFAULT "[]" NOT NULL\n);`,
        //`-- Somewhere to keep our metadata\n`,
        `CREATE TABLE IF NOT EXISTS ${metaTable} (\n  key TEXT PRIMARY KEY,\n  value BLOB\n);`,
        //`-- Somewhere to track migrations\n`,
        `CREATE TABLE IF NOT EXISTS ${migrationsTable} (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  version TEXT NOT NULL UNIQUE,\n  applied_at TEXT NOT NULL\n);`,
        //`-- Initialisation of the metadata table\n`,
        `INSERT INTO ${metaTable} (key, value) VALUES ('compensations', 0), ('lastAckdRowId','0'), ('lastSentRowId', '0'), ('lsn', ''), ('clientId', ''), ('token', 'INITIAL_INVALID_TOKEN'), ('refreshToken', '');`,
        //`-- These are toggles for turning the triggers on and off\n`,
        `DROP TABLE IF EXISTS ${triggersTable};`,
        `CREATE TABLE ${triggersTable} (tablename STRING PRIMARY KEY, flag INTEGER);`,
        //`-- Somewhere to keep dependency tracking information\n`,
        `CREATE TABLE ${shadowTable} (\n  namespace String NOT NULL,\n  tablename String NOT NULL,\n  primaryKey String NOT NULL,\n  tags TEXT NOT NULL,\n  PRIMARY KEY (namespace, tablename, primaryKey));`,
      ],
      version: '0',
    },
  ],
}
