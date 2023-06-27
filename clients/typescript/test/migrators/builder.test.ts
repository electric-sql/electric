import test from 'ava'
import { makeMigration, parseMetadata } from '../../src/migrators/builder'
import { loadMigrations } from '../../src/cli'
import {
  SatOpMigrate,
  SatOpMigrate_Table,
  SatOpMigrate_Type,
  SatOpMigrate_Stmt,
  SatOpMigrate_Column,
  SatOpMigrate_PgColumnType,
} from '../../src/_generated/protocol/satellite'
import _m0 from 'protobufjs/minimal.js'
import Database from 'better-sqlite3'
import { electrify } from '../../src/drivers/better-sqlite3'
import path from 'path'
import { DbSchema } from '../../src/client/model'

function encodeSatOpMigrateMsg(request: SatOpMigrate) {
  return (
    SatOpMigrate.encode(request, _m0.Writer.create()).finish() as any
  ).toString('base64')
}

const migrationMetaData = {
  format: 'SatOpMigrate',
  ops: [
    encodeSatOpMigrateMsg(
      SatOpMigrate.fromPartial({
        version: '20230613112725_814',
        stmts: [
          SatOpMigrate_Stmt.fromPartial({
            type: SatOpMigrate_Type.CREATE_TABLE,
            sql: 'CREATE TABLE "stars" (\n  "id" TEXT NOT NULL,\n  "avatar_url" TEXT NOT NULL,\n  "name" TEXT,\n  "starred_at" TEXT NOT NULL,\n  "username" TEXT NOT NULL,\n  CONSTRAINT "stars_pkey" PRIMARY KEY ("id")\n) WITHOUT ROWID;\n',
          }),
        ],
        table: SatOpMigrate_Table.fromPartial({
          name: 'stars',
          columns: [
            SatOpMigrate_Column.fromPartial({
              name: 'id',
              sqliteType: 'TEXT',
              pgType: SatOpMigrate_PgColumnType.fromPartial({
                name: 'text',
                array: [],
                size: [],
              }),
            }),
            SatOpMigrate_Column.fromPartial({
              name: 'avatar_url',
              sqliteType: 'TEXT',
              pgType: SatOpMigrate_PgColumnType.fromPartial({
                name: 'text',
                array: [],
                size: [],
              }),
            }),
            SatOpMigrate_Column.fromPartial({
              name: 'name',
              sqliteType: 'TEXT',
              pgType: SatOpMigrate_PgColumnType.fromPartial({
                name: 'text',
                array: [],
                size: [],
              }),
            }),
            SatOpMigrate_Column.fromPartial({
              name: 'starred_at',
              sqliteType: 'TEXT',
              pgType: SatOpMigrate_PgColumnType.fromPartial({
                name: 'text',
                array: [],
                size: [],
              }),
            }),
            SatOpMigrate_Column.fromPartial({
              name: 'username',
              sqliteType: 'TEXT',
              pgType: SatOpMigrate_PgColumnType.fromPartial({
                name: 'text',
                array: [],
                size: [],
              }),
            }),
          ],
          fks: [],
          pks: ['id'],
        }),
      })
    ),
  ],
  protocol_version: 'Electric.Satellite.v1_4',
  version: '20230613112725_814',
}

test('parse migration meta data', (t) => {
  const metaData = parseMetadata(migrationMetaData)
  t.assert(metaData.ops[0].table?.name === 'stars')
  t.assert(metaData.ops[0].table?.columns.length === 5)
})

test('generate migration from meta data', (t) => {
  const metaData = parseMetadata(migrationMetaData)
  const migration = makeMigration(metaData)
  t.assert(migration.version === migrationMetaData.version)
  t.assert(
    migration.statements[0],
    'CREATE TABLE "stars" (\n  "id" TEXT NOT NULL,\n  "avatar_url" TEXT NOT NULL,\n  "name" TEXT,\n  "starred_at" TEXT NOT NULL,\n  "username" TEXT NOT NULL,\n  CONSTRAINT "stars_pkey" PRIMARY KEY ("id")\n) WITHOUT ROWID;\n'
  )
  t.assert(
    migration.statements[3],
    "\n    CREATE TRIGGER update_ensure_main_stars_primarykey\n      BEFORE UPDATE ON main.stars\n    BEGIN\n      SELECT\n        CASE\n          WHEN old.id != new.id THEN\n\t\tRAISE (ABORT, 'cannot change the value of column id as it belongs to the primary key')\n        END;\n    END;\n    "
  )
})

const migrationsFolder = path.join('./test/migrators/support/migrations')

test('read migration meta data', async (t) => {
  const migrations = await loadMigrations(migrationsFolder)
  const versions = migrations.map((m) => m.version)
  t.deepEqual(versions, ['20230613112725_814', '20230613112735_992'])
})

test('load migration from meta data', async (t) => {
  const db = new Database(':memory:')
  const migration = makeMigration(parseMetadata(migrationMetaData))
  const electric = await electrify(db, new DbSchema({}), {
    app: 'migration-loader-test',
    env: 'env',
    migrations: [migration],
  })

  // Check that the DB is initialized with the stars table
  const tables = await electric.db.raw({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name='stars';`,
  })

  const starIdx = tables.findIndex((tbl) => tbl.name === 'stars')
  t.assert(starIdx >= 0) // must exist

  const columns = await electric.db
    .raw({
      sql: `PRAGMA table_info(stars);`,
    })
    .then((columns) => columns.map((column) => column.name))

  t.deepEqual(columns, ['id', 'avatar_url', 'name', 'starred_at', 'username'])
})
