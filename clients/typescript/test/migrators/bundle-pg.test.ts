import test from 'ava'
import Database from 'better-sqlite3'

import EmbeddedPostgres from 'embedded-postgres';
import { ElectricDatabase as DatabasePostgres } from '../../src/drivers/postgres/database'
import { DatabaseAdapter as DatabaseAdapterPostgres } from '../../src/drivers/postgres/adapter'

import { rm as remove } from 'node:fs/promises'

import { DatabaseAdapter } from '../../src/drivers/better-sqlite3/adapter'
import { BundleMigrator } from '../../src/migrators/bundle'
import { makeStmtMigration } from '../../src/migrators'

import { randomValue } from '../../src/util/random'

import migrations from '../support/migrations/migrations.js'


import { BindParams, SqlValue, Statement } from '../../../typescript/src/util'
import { QueryExecResult } from '../../../typescript/src/drivers/util/results'

function separateBindParams(params: BindParams | undefined): [SqlValue[], string[]] {
  if (typeof params === "undefined") {
    return [[], []]
  }

  if (Array.isArray(params)) {
    // If params is an array of SqlValue, return it and an empty string array
    return [params, []];
  } else {
    // If params is a Row, convert it into two arrays
    const sqlValues: SqlValue[] = [];
    const keys: string[] = [];

    for (const key in params) {
      if (params.hasOwnProperty(key)) {
        keys.push(key);
        sqlValues.push(params[key]);
      }
    }

    return [sqlValues, keys];
  }
}


test.beforeEach(async (t) => {

  const databaseDir = "./data/db";

  // Equivalent of `const db = new Database();`
  // What is the equivalent of `const adapter = new DatabaseAdapter(db);`?
  // Should I send just the query function to the sqlx driver?? not the entire invoke?

  // const pg = new EmbeddedPostgres({
  //   databaseDir: databaseDir,
  //   user: 'postgres',
  //   password: 'password',
  //   port: 54321,
  //   persistent: false,
  // });

  // await pg.initialise();
  // await pg.start();
  // await pg.createDatabase('TEST');
  // // await pg.dropDatabase('TEST');
  // const client = pg.getPgClient();
  // await client.connect();
  // // const result = await client.query('SELECT datname FROM pg_database');
  // // console.log(result);
  // console.log(await client.query('CREATE TABLE test (description TEXT, rowid SERIAL PRIMARY KEY)'));
  // console.log(await client.query('SELECT * FROM test'));
  // console.log(await client.query('INSERT INTO test(description) VALUES (\'123\')'));
  // console.log(await client.query('INSERT INTO test(description) VALUES (\'456\')'));
  // console.log(await client.query('SELECT * FROM test'));

  // // await pg.stop();

  const dbName = `bundle-migrator-${randomValue()}.db`
  const db = new Database(dbName)
  const adapter = new DatabaseAdapter(db)

  let db_pg = await DatabasePostgres.init(databaseDir)
  let db_pg_adapter = new DatabaseAdapterPostgres(db_pg)

  t.context = {
    adapter,
    dbName,
    // pg,
    db_pg_adapter,
    databaseDir,
  }
})

test.afterEach.always(async (t) => {
  const { dbName,
    //  pg,
      db_pg_adapter, databaseDir } = t.context as any

  // await pg.stop();
  await (<DatabaseAdapterPostgres>db_pg_adapter).stop()

  // Remove sqlite files
  await remove(dbName, { force: true })
  await remove(`${dbName}-journal`, { force: true })

  // Remove postgres directory
  await remove(databaseDir, { force: true, recursive: true });
})

/// Use this test as a knowledge building test
/// to find out more about embedded-postgres
test.serial('postgres playground', async (t) => {
  console.log("==================================================================================================================")
  let {
    // pg
    db_pg_adapter
   } = t.context as any
  // (<DatabaseAdapterPostgres>db_pg_adapter)
  // const client = (<EmbeddedPostgres>pg).getPgClient()

  // await client.connect()
  // let result = await client.query("SELECT * FROM test WHERE rowid = $1", [(<SqlValue>1)])
  // console.log(result)

  // result = await client.query("SELECT * FROM test", [])
  // console.log(result)

  // console.log("==================================================================================================================")
  // console.log(result["fields"][0]["name"])

  // let rows: SqlValue[][] = []
  // let cols: string[] = []

  // TODO: fill in the gaps here.
  // cols = result["fields"].map((field: any) => field.name)

  // rows = cols.map(column => {
  //   return result["rows"].map((row: any) => {
  //     return row[column]
  //   })
  // })
  // TODO: fill in the gaps here.
  // console.log(cols)
  // console.log(rows)
  // console.log({
  //     columns: cols,
  //     values: rows,
  //   }
  // )

  // console.log("==================================================================================================================")

  // let result2 = separateBindParams([1])
  // console.log(result2)
  // result2 = separateBindParams({"some key": 1})
  // console.log(result2)

  // console.log("==================================================================================================================")

  // console.log(db_pg_adapter.exec())
  const migrator = new BundleMigrator(db_pg_adapter, migrations)
  console.log(separateBindParams([ '_electric_migrations' ]))
  console.log(await migrator.migrationsTableExists(true))


  // ava knows we hadn't had any asserts
  t.assert(true)
})

test.serial('sqlite agrees with postgres', async (t) => {
  const { adapter, db_pg_adapter } = t.context as any

  const migrator_sqlite = new BundleMigrator(adapter, migrations)
  const migrator_postgres = new BundleMigrator(db_pg_adapter, migrations)

  t.is(await migrator_sqlite.migrationsTableExists(), await migrator_postgres.migrationsTableExists(true))
  t.deepEqual(await migrator_sqlite.queryApplied(), await migrator_postgres.queryApplied(true))
  t.deepEqual(await migrator_sqlite.querySchemaVersion(), await migrator_postgres.querySchemaVersion(true))
})


test.serial('run the bundle migrator', async (t) => {
  const { adapter, db_pg_adapter } = t.context as any

  const migrator = new BundleMigrator(adapter, migrations)
  t.is(await migrator.up(), 3)
  t.is(await migrator.up(), 0)

  const migratorPostgres = new BundleMigrator(db_pg_adapter, migrations)
  t.is(await migratorPostgres.up(true), 3)
  t.is(await migratorPostgres.up(true), 0)

})

test.serial('applyIfNotAlready applies new migrations', async (t) => {
  const { adapter } = t.context as any

  const allButLastMigrations = migrations.slice(0, -1)
  const lastMigration = makeStmtMigration(migrations[migrations.length - 1])

  const migrator = new BundleMigrator(adapter, allButLastMigrations)
  t.is(await migrator.up(), 2)

  const wasApplied = await migrator.applyIfNotAlready(lastMigration)
  t.assert(wasApplied)
})

test.serial('applyIfNotAlready ignores already applied migrations', async (t) => {
  const { adapter } = t.context as any

  const migrator = new BundleMigrator(adapter, migrations)
  t.is(await migrator.up(), 3)

  const wasApplied = await migrator.applyIfNotAlready(
    makeStmtMigration(migrations[0])
  )
  t.assert(!wasApplied)
})
