import { satelliteDefaults } from '../satellite/config'

const { metaTable, migrationsTable, oplogTable, triggersTable, shadowTable } =
  satelliteDefaults

export const data = {
  migrations: [
    {
      statements: [
        `CREATE SCHEMA IF NOT EXISTS main`,
        `CREATE TABLE IF NOT EXISTS ${oplogTable} (\n  rowid SERIAL PRIMARY KEY,\n  namespace TEXT NOT NULL,\n  tablename TEXT NOT NULL,\n  optype TEXT NOT NULL,\n  primaryKey TEXT NOT NULL,\n  newRow TEXT,\n  oldRow TEXT,\n  timestamp TEXT,  clearTags TEXT DEFAULT '[]' NOT NULL\n);`,
        `CREATE INDEX IF NOT EXISTS _electric_table_pk_reference ON ${oplogTable} (\n namespace, tablename, primaryKey)`,
        `CREATE INDEX IF NOT EXISTS _electric_timestamp ON ${oplogTable} (timestamp);`,
        `CREATE TABLE IF NOT EXISTS ${metaTable} (key TEXT PRIMARY KEY, value TEXT)`,
        // `
        // ALTER TABLE ${metaTable}
        //   DROP CONSTRAINT IF EXISTS meta_table_pkey,
        //   ADD CONSTRAINT meta_table_pkey PRIMARY KEY (key) DEFERRABLE INITIALLY DEFERRED;
        // `,

        `CREATE TABLE IF NOT EXISTS ${migrationsTable} (id SERIAL, version TEXT NOT NULL UNIQUE, applied_at TEXT NOT NULL);`,
        `
        ALTER TABLE ${migrationsTable}
          DROP CONSTRAINT IF EXISTS migrations_table_pkey,
          ADD CONSTRAINT migrations_table_pkey PRIMARY KEY (id) INITIALLY DEFERRED;
        `,
        // `
        // ALTER TABLE ${migrationsTable}
        //   DROP CONSTRAINT IF EXISTS version_unique,
        //   ADD CONSTRAINT version_unique UNIQUE (version) DEFERRABLE INITIALLY DEFERRED;
        // `,

        `INSERT INTO ${metaTable} (key, value) VALUES ('compensations', '1'), ('lsn', ''), ('clientId', ''), ('subscriptions', '') ON CONFLICT DO NOTHING;`,
        `DROP TABLE IF EXISTS ${triggersTable};`,
        `CREATE TABLE ${triggersTable} (tablename TEXT PRIMARY KEY, flag INTEGER);`,
        `DROP TABLE IF EXISTS ${shadowTable};`,
        `CREATE TABLE ${shadowTable} (rowid SERIAL,\n  namespace TEXT NOT NULL,\n  tablename TEXT NOT NULL,\n  primaryKey TEXT NOT NULL,\n  tags TEXT NOT NULL,\n  PRIMARY KEY (namespace, tablename, primaryKey));`,
       ],
       version: '0',
     },
    ]
}
