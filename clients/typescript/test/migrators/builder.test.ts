import test from 'ava'
import { makeMigration, parseMetadata } from '../../src/migrators/builder'
import { loadMigrations } from '../../src/cli/migrations/builder'
import {
  SatOpMigrate,
  SatOpMigrate_Table,
  SatOpMigrate_Type,
  SatOpMigrate_Stmt,
  SatOpMigrate_Column,
  SatOpMigrate_PgColumnType,
} from '../../src/_generated/protocol/satellite'
import _m0 from 'protobufjs/minimal.js'
import path from 'path'
import { DbSchema } from '../../src/client/model'
import { MockSocket } from '../../src/sockets/mock'

// import Database from 'better-sqlite3'
// import { electrify } from '../../src/drivers/better-sqlite3'
import { ElectricDatabase as Database } from '../../src/drivers/postgres/database'
import { electrify } from '../../src/drivers/postgres'

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
            sql: 'CREATE TABLE stars (id TEXT NOT NULL PRIMARY KEY, avatar_url TEXT NOT NULL, name TEXT, starred_at TEXT NOT NULL, username TEXT NOT NULL);',
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
  protocol_version: 'Electric.Satellite',
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
    'CREATE TABLE stars (id TEXT NOT NULL PRIMARY KEY, avatar_url TEXT NOT NULL, name TEXT, starred_at TEXT NOT NULL, username TEXT NOT NULL);'
  )
  t.assert(
    migration.statements[3],
    `
    CREATE OR REPLACE FUNCTION update_ensure_main_stars_primarykey_function()
    RETURNS TRIGGER AS $$
    BEGIN
      IF OLD.id IS DISTINCT FROM NEW.id THEN
        RAISE EXCEPTION 'Cannot change the value of column id as it belongs to the primary key';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER update_ensure_main_stars_primarykey
    BEFORE UPDATE ON main.stars
    FOR EACH ROW
    EXECUTE FUNCTION update_ensure_main_stars_primarykey_function();
    `
  )
})

const migrationsFolder = path.join('./test/migrators/support/migrations')

test('read migration meta data', async (t) => {
  const migrations = await loadMigrations(migrationsFolder)
  const versions = migrations.map((m) => m.version)
  t.deepEqual(versions, ['20230613112725_814', '20230613112735_992'])
})

test('load migration from meta data', async (t) => {
  const db = await Database.init("./not/memory")
  const migration = makeMigration(parseMetadata(migrationMetaData))
  const electric = await electrify(
    db,
    new DbSchema({}, [migration]),
    {
      auth: {
        token: 'test-token',
      },
    },
    { socketFactory: MockSocket }
  )

  // Check that the DB is initialized with the stars table
  const tables = await electric.db.raw({
    sql: `
    SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'stars';
    `,
  })

  const starIdx = tables.findIndex((tbl) => tbl.name === 'stars')
  t.assert(starIdx >= 0) // must exist

  const columns = await electric.db
    .raw({
      sql: `SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_name = 'stars';`,
    })
    .then((columns) => columns.map((column) => column.name))

  t.deepEqual(columns, ['id', 'avatar_url', 'name', 'starred_at', 'username'])
})
