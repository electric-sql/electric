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
  SatOpMigrate_ForeignKey,
} from '../../src/_generated/protocol/satellite'
import _m0 from 'protobufjs/minimal.js'
import Database from 'better-sqlite3'
import { electrify } from '../../src/drivers/better-sqlite3'
import path from 'path'
import { DbSchema } from '../../src/client/model'
import { MockSocket } from '../../src/sockets/mock'

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
  protocol_version: 'Electric.Satellite',
  version: '20230613112725_814',
}

test('parse migration meta data', (t) => {
  const metaData = parseMetadata(migrationMetaData)
  t.is(metaData.ops[0].table?.name, 'stars')
  t.is(metaData.ops[0].table?.columns.length, 5)
})

test('generate migration from meta data', (t) => {
  const metaData = parseMetadata(migrationMetaData)
  const migration = makeMigration(metaData)
  t.is(migration.version, migrationMetaData.version)
  t.is(
    migration.statements[0],
    'CREATE TABLE "stars" (\n  "id" TEXT NOT NULL,\n  "avatar_url" TEXT NOT NULL,\n  "name" TEXT,\n  "starred_at" TEXT NOT NULL,\n  "username" TEXT NOT NULL,\n  CONSTRAINT "stars_pkey" PRIMARY KEY ("id")\n) WITHOUT ROWID;\n'
  )
  t.is(
    migration.statements[3],
    'CREATE TRIGGER update_ensure_main_stars_primarykey\n  BEFORE UPDATE ON "main"."stars"\nBEGIN\n  SELECT\n    CASE\n      WHEN old."id" != new."id" THEN\n      \t\tRAISE (ABORT, \'cannot change the value of column id as it belongs to the primary key\')\n    END;\nEND;'
  )
})

test('make migration for table with FKs', (t) => {
  /*
   SatOpMigrate_ForeignKey.fromPartial({
              fkCols: ['']
            })
  */

  const migration = {
    format: 'SatOpMigrate',
    ops: [
      encodeSatOpMigrateMsg(
        SatOpMigrate.fromPartial({
          version: '1',
          stmts: [
            SatOpMigrate_Stmt.fromPartial({
              type: 0,
              sql: 'CREATE TABLE "tenants" (\n  "id" TEXT NOT NULL,\n  "name" TEXT NOT NULL,\n  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")\n) WITHOUT ROWID;\n',
            }),
          ],
          table: SatOpMigrate_Table.fromPartial({
            name: 'tenants',
            columns: [
              SatOpMigrate_Column.fromPartial({
                name: 'id',
                sqliteType: 'TEXT',
                pgType: {
                  $type: 'Electric.Satellite.SatOpMigrate.PgColumnType',
                  name: 'uuid',
                  array: [],
                  size: [],
                },
              }),
              SatOpMigrate_Column.fromPartial({
                name: 'name',
                sqliteType: 'TEXT',
                pgType: {
                  $type: 'Electric.Satellite.SatOpMigrate.PgColumnType',
                  name: 'text',
                  array: [],
                  size: [],
                },
              }),
            ],
            fks: [],
            pks: ['id'],
          }),
        })
      ),
      encodeSatOpMigrateMsg(
        SatOpMigrate.fromPartial({
          version: '1',
          stmts: [
            SatOpMigrate_Stmt.fromPartial({
              type: 0,
              sql: 'CREATE TABLE "users" (\n  "id" TEXT NOT NULL,\n  "name" TEXT NOT NULL,\n  "email" TEXT NOT NULL,\n  "password_hash" TEXT NOT NULL,\n  CONSTRAINT "users_pkey" PRIMARY KEY ("id")\n) WITHOUT ROWID;\n',
            }),
          ],
          table: SatOpMigrate_Table.fromPartial({
            name: 'users',
            columns: [
              SatOpMigrate_Column.fromPartial({
                name: 'id',
                sqliteType: 'TEXT',
                pgType: SatOpMigrate_PgColumnType.fromPartial({
                  name: 'uuid',
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
                name: 'email',
                sqliteType: 'TEXT',
                pgType: SatOpMigrate_PgColumnType.fromPartial({
                  name: 'text',
                  array: [],
                  size: [],
                }),
              }),
              SatOpMigrate_Column.fromPartial({
                name: 'password_hash',
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
      encodeSatOpMigrateMsg(
        SatOpMigrate.fromPartial({
          version: '1',
          stmts: [
            SatOpMigrate_Stmt.fromPartial({
              type: 0,
              sql: 'CREATE TABLE "tenant_users" (\n  "tenant_id" TEXT NOT NULL,\n  "user_id" TEXT NOT NULL,\n  CONSTRAINT "tenant_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE,\n  CONSTRAINT "tenant_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,\n  CONSTRAINT "tenant_users_pkey" PRIMARY KEY ("tenant_id", "user_id")\n) WITHOUT ROWID;\n',
            }),
          ],
          table: SatOpMigrate_Table.fromPartial({
            name: 'tenant_users',
            columns: [
              SatOpMigrate_Column.fromPartial({
                name: 'tenant_id',
                sqliteType: 'TEXT',
                pgType: SatOpMigrate_PgColumnType.fromPartial({
                  name: 'uuid',
                  array: [],
                  size: [],
                }),
              }),
              SatOpMigrate_Column.fromPartial({
                name: 'user_id',
                sqliteType: 'TEXT',
                pgType: SatOpMigrate_PgColumnType.fromPartial({
                  name: 'uuid',
                  array: [],
                  size: [],
                }),
              }),
            ],
            fks: [
              SatOpMigrate_ForeignKey.fromPartial({
                fkCols: ['tenant_id'],
                pkTable: 'tenants',
                pkCols: ['id'],
              }),
              SatOpMigrate_ForeignKey.fromPartial({
                fkCols: ['user_id'],
                pkTable: 'users',
                pkCols: ['id'],
              }),
            ],
            pks: ['tenant_id', 'user_id'],
          }),
        })
      ),
    ],
    protocol_version: 'Electric.Satellite',
    version: '1',
  }

  //const migrateMetaData = JSON.parse(`{"format":"SatOpMigrate","ops":["GjcKB3RlbmFudHMSEgoCaWQSBFRFWFQaBgoEdXVpZBIUCgRuYW1lEgRURVhUGgYKBHRleHQiAmlkCgExEooBEocBQ1JFQVRFIFRBQkxFICJ0ZW5hbnRzIiAoCiAgImlkIiBURVhUIE5PVCBOVUxMLAogICJuYW1lIiBURVhUIE5PVCBOVUxMLAogIENPTlNUUkFJTlQgInRlbmFudHNfcGtleSIgUFJJTUFSWSBLRVkgKCJpZCIpCikgV0lUSE9VVCBST1dJRDsK","GmsKBXVzZXJzEhIKAmlkEgRURVhUGgYKBHV1aWQSFAoEbmFtZRIEVEVYVBoGCgR0ZXh0EhUKBWVtYWlsEgRURVhUGgYKBHRleHQSHQoNcGFzc3dvcmRfaGFzaBIEVEVYVBoGCgR0ZXh0IgJpZAoBMRLAARK9AUNSRUFURSBUQUJMRSAidXNlcnMiICgKICAiaWQiIFRFWFQgTk9UIE5VTEwsCiAgIm5hbWUiIFRFWFQgTk9UIE5VTEwsCiAgImVtYWlsIiBURVhUIE5PVCBOVUxMLAogICJwYXNzd29yZF9oYXNoIiBURVhUIE5PVCBOVUxMLAogIENPTlNUUkFJTlQgInVzZXJzX3BrZXkiIFBSSU1BUlkgS0VZICgiaWQiKQopIFdJVEhPVVQgUk9XSUQ7Cg==","GoYBCgx0ZW5hbnRfdXNlcnMSGQoJdGVuYW50X2lkEgRURVhUGgYKBHV1aWQSFwoHdXNlcl9pZBIEVEVYVBoGCgR1dWlkGhgKCXRlbmFudF9pZBIHdGVuYW50cxoCaWQaFAoHdXNlcl9pZBIFdXNlcnMaAmlkIgl0ZW5hbnRfaWQiB3VzZXJfaWQKATESkgMSjwNDUkVBVEUgVEFCTEUgInRlbmFudF91c2VycyIgKAogICJ0ZW5hbnRfaWQiIFRFWFQgTk9UIE5VTEwsCiAgInVzZXJfaWQiIFRFWFQgTk9UIE5VTEwsCiAgQ09OU1RSQUlOVCAidGVuYW50X3VzZXJzX3RlbmFudF9pZF9ma2V5IiBGT1JFSUdOIEtFWSAoInRlbmFudF9pZCIpIFJFRkVSRU5DRVMgInRlbmFudHMiICgiaWQiKSBPTiBERUxFVEUgQ0FTQ0FERSwKICBDT05TVFJBSU5UICJ0ZW5hbnRfdXNlcnNfdXNlcl9pZF9ma2V5IiBGT1JFSUdOIEtFWSAoInVzZXJfaWQiKSBSRUZFUkVOQ0VTICJ1c2VycyIgKCJpZCIpIE9OIERFTEVURSBDQVNDQURFLAogIENPTlNUUkFJTlQgInRlbmFudF91c2Vyc19wa2V5IiBQUklNQVJZIEtFWSAoInRlbmFudF9pZCIsICJ1c2VyX2lkIikKKSBXSVRIT1VUIFJPV0lEOwo="],"protocol_version":"Electric.Satellite","version":"1"}`)
  const metaData = parseMetadata(migration)
  makeMigration(metaData)
  t.pass()
})

test('generate index creation migration from meta data', (t) => {
  const metaData = parseMetadata({
    format: 'SatOpMigrate',
    ops: [
      encodeSatOpMigrateMsg(
        SatOpMigrate.fromPartial({
          version: '20230613112725_814',
          stmts: [
            SatOpMigrate_Stmt.create({
              type: SatOpMigrate_Type.CREATE_INDEX,
              sql: 'CREATE INDEX idx_stars_username ON stars(username);',
            }),
          ],
        })
      ),
    ],
    protocol_version: 'Electric.Satellite',
    version: '20230613112725_814',
  })
  const migration = makeMigration(metaData)
  t.is(migration.version, migrationMetaData.version)
  t.deepEqual(migration.statements, [
    'CREATE INDEX idx_stars_username ON stars(username);',
  ])
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
