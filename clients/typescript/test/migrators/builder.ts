import { TestFn } from 'ava'
import { dedent } from 'ts-dedent'
import { makeMigration, parseMetadata } from '../../src/migrators/builder'
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
import { QueryBuilder } from '../../src/migrators/query-builder'

function encodeSatOpMigrateMsg(request: SatOpMigrate) {
  return (
    SatOpMigrate.encode(request, _m0.Writer.create()).finish() as any
  ).toString('base64')
}

export const makeMigrationMetaData = (builder: QueryBuilder) => {
  return {
    format: 'SatOpMigrate',
    ops: [
      encodeSatOpMigrateMsg(
        SatOpMigrate.fromPartial({
          version: '20230613112725_814',
          stmts: [
            SatOpMigrate_Stmt.fromPartial({
              type: SatOpMigrate_Type.CREATE_TABLE,
              sql: `CREATE TABLE "${builder.defaultNamespace}"."stars" (\n  "id" TEXT NOT NULL PRIMARY KEY,\n  "avatar_url" TEXT NOT NULL,\n  "name" TEXT,\n  "starred_at" TEXT NOT NULL,\n  "username" TEXT NOT NULL\n);\n`,
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
}

export type ContextType = {
  migrationMetaData: ReturnType<typeof makeMigrationMetaData>
  builder: QueryBuilder
}

export const builderTests = (test: TestFn<ContextType>) => {
  test('parse migration meta data', (t) => {
    const { migrationMetaData } = t.context
    const metaData = parseMetadata(migrationMetaData)
    t.is(metaData.ops[0].table?.name, 'stars')
    t.is(metaData.ops[0].table?.columns.length, 5)
  })

  test('generate migration from meta data', (t) => {
    const { migrationMetaData, builder } = t.context
    const metaData = parseMetadata(migrationMetaData)
    const migration = makeMigration(metaData, builder)
    t.is(migration.version, migrationMetaData.version)
    t.is(
      migration.statements[0],
      `CREATE TABLE "${builder.defaultNamespace}"."stars" (\n  "id" TEXT NOT NULL PRIMARY KEY,\n  "avatar_url" TEXT NOT NULL,\n  "name" TEXT,\n  "starred_at" TEXT NOT NULL,\n  "username" TEXT NOT NULL\n);\n`
    )

    if (builder.dialect === 'SQLite') {
      t.is(
        migration.statements[3],
        `CREATE TRIGGER update_ensure_${builder.defaultNamespace}_stars_primarykey\n  BEFORE UPDATE ON "${builder.defaultNamespace}"."stars"\nBEGIN\n  SELECT\n    CASE\n      WHEN old."id" != new."id" THEN\n      \t\tRAISE (ABORT, 'cannot change the value of column id as it belongs to the primary key')\n    END;\nEND;`
      )
    } else {
      // Postgres
      t.is(
        migration.statements[3],
        dedent`
        CREATE OR REPLACE FUNCTION update_ensure_${builder.defaultNamespace}_stars_primarykey_function()
        RETURNS TRIGGER AS $$
        BEGIN
          IF OLD."id" IS DISTINCT FROM NEW."id" THEN
            RAISE EXCEPTION 'Cannot change the value of column id as it belongs to the primary key';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
      `
      )

      t.is(
        migration.statements[4],
        dedent`
        CREATE TRIGGER update_ensure_${builder.defaultNamespace}_stars_primarykey
          BEFORE UPDATE ON "${builder.defaultNamespace}"."stars"
            FOR EACH ROW
              EXECUTE FUNCTION update_ensure_${builder.defaultNamespace}_stars_primarykey_function();
      `
      )
    }
  })

  test('make migration for table with FKs', (t) => {
    const { builder } = t.context
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
                sql: `CREATE TABLE "${builder.defaultNamespace}"."tenants" (\n  "id" TEXT NOT NULL,\n  "name" TEXT NOT NULL,\n  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")\n);\n`,
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
                sql: `CREATE TABLE "${builder.defaultNamespace}"."users" (\n  "id" TEXT NOT NULL,\n  "name" TEXT NOT NULL,\n  "email" TEXT NOT NULL,\n  "password_hash" TEXT NOT NULL,\n  CONSTRAINT "users_pkey" PRIMARY KEY ("id")\n);\n`,
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
                sql: `CREATE TABLE "${builder.defaultNamespace}"."tenant_users" (\n  "tenant_id" TEXT NOT NULL,\n  "user_id" TEXT NOT NULL,\n  CONSTRAINT "tenant_users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE CASCADE,\n  CONSTRAINT "tenant_users_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE,\n  CONSTRAINT "tenant_users_pkey" PRIMARY KEY ("tenant_id", "user_id")\n);\n`,
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

    const metaData = parseMetadata(migration)
    makeMigration(metaData, builder)
    t.pass()
  })

  test('generate index creation migration from meta data', (t) => {
    const { migrationMetaData, builder } = t.context
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
    const migration = makeMigration(metaData, builder)
    t.is(migration.version, migrationMetaData.version)
    t.deepEqual(migration.statements, [
      'CREATE INDEX idx_stars_username ON stars(username);',
    ])
  })

  test('prepareInsertBatchedStatements correctly splits up data in batches', (t) => {
    const { builder } = t.context
    const data = [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
      { a: 5, b: 6 },
    ]
    const stmts = builder.prepareInsertBatchedStatements(
      'INSERT INTO test (a, b) VALUES',
      ['a', 'b'],
      data,
      5 // at most 5 `?`s in one SQL statement, so we should see the split
    )

    const posArgs: string[] =
      builder.dialect === 'SQLite'
        ? ['?', '?', '?', '?']
        : ['$1', '$2', '$3', '$4']

    t.deepEqual(stmts, [
      {
        sql: `INSERT INTO test (a, b) VALUES (${posArgs[0]}, ${posArgs[1]}), (${posArgs[2]}, ${posArgs[3]})`,
        args: [1, 2, 3, 4],
      },
      {
        sql: `INSERT INTO test (a, b) VALUES (${posArgs[0]}, ${posArgs[1]})`,
        args: [5, 6],
      },
    ])
  })

  test('prepareInsertBatchedStatements respects column order', (t) => {
    const { builder } = t.context
    const data = [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
      { a: 5, b: 6 },
    ]
    const stmts = builder.prepareInsertBatchedStatements(
      'INSERT INTO test (a, b) VALUES',
      ['b', 'a'],
      data,
      5
    )

    const posArgs: string[] =
      builder.dialect === 'SQLite'
        ? ['?', '?', '?', '?']
        : ['$1', '$2', '$3', '$4']

    t.deepEqual(stmts, [
      {
        sql: `INSERT INTO test (a, b) VALUES (${posArgs[0]}, ${posArgs[1]}), (${posArgs[2]}, ${posArgs[3]})`,
        args: [2, 1, 4, 3],
      },
      {
        sql: `INSERT INTO test (a, b) VALUES (${posArgs[0]}, ${posArgs[1]})`,
        args: [6, 5],
      },
    ])
  })

  test('prepareDeleteBatchedStatements correctly splits up data in batches', (t) => {
    const { builder } = t.context
    const data = [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
      { a: 5, b: 6 },
    ]
    const stmts = builder.prepareDeleteBatchedStatements(
      'DELETE FROM test WHERE',
      ['a', 'b'],
      data,
      5 // at most 5 `?`s in one SQL statement, so we should see the split
    )

    const posArgs: string[] =
      builder.dialect === 'SQLite'
        ? ['?', '?', '?', '?']
        : ['$1', '$2', '$3', '$4']

    t.deepEqual(stmts, [
      {
        sql: `DELETE FROM test WHERE ("a" = ${posArgs[0]} AND "b" = ${posArgs[1]}) OR ("a" = ${posArgs[2]} AND "b" = ${posArgs[3]})`,

        args: [1, 2, 3, 4],
      },
      {
        sql: `DELETE FROM test WHERE ("a" = ${posArgs[0]} AND "b" = ${posArgs[1]})`,
        args: [5, 6],
      },
    ])
  })

  test('prepareDeleteBatchedStatements respects column order', (t) => {
    const { builder } = t.context
    const data = [
      { a: 1, b: 2 },
      { a: 3, b: 4 },
      { a: 5, b: 6 },
    ]
    const stmts = builder.prepareDeleteBatchedStatements(
      'DELETE FROM test WHERE',
      ['b', 'a'],
      data,
      5
    )

    const posArgs: string[] =
      builder.dialect === 'SQLite'
        ? ['?', '?', '?', '?']
        : ['$1', '$2', '$3', '$4']

    t.deepEqual(stmts, [
      {
        sql: `DELETE FROM test WHERE ("b" = ${posArgs[0]} AND "a" = ${posArgs[1]}) OR ("b" = ${posArgs[2]} AND "a" = ${posArgs[3]})`,
        args: [2, 1, 4, 3],
      },
      {
        sql: `DELETE FROM test WHERE ("b" = ${posArgs[0]} AND "a" = ${posArgs[1]})`,
        args: [6, 5],
      },
    ])
  })
}
