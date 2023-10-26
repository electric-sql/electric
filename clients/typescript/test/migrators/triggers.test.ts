import { dedent } from 'ts-dedent'
import Database from 'better-sqlite3'
import testAny, { TestFn } from 'ava'
import { generateTableTriggers } from '../../src/migrators/triggers'
import { randomValue } from '../../src/util/random'
import type { Database as SqliteDB } from 'better-sqlite3'
import { satelliteDefaults } from '../../src/satellite/config'
import { migrateDb, personTable } from '../satellite/common'

type Context = { db: SqliteDB; migrateDb: () => void }
const test = testAny as TestFn<Context>

test.beforeEach(async (t) => {
  const dbName = `triggers-test-${randomValue()}.db`
  const db = new Database(dbName)

  t.context = {
    db,
    migrateDb: migrateDb.bind(null, db, personTable),
  }
})

test('generateTableTriggers should create correct triggers for a table', (t) => {
  // Generate the oplog triggers
  const triggers = generateTableTriggers(personTable.tableName, personTable)

  // Check that the oplog triggers are correct
  const triggersSQL = triggers.map((t) => t.sql).join('\n')
  t.assert(
    triggersSQL.includes(
      dedent`
    CREATE TRIGGER insert_main_personTable_into_oplog
       AFTER INSERT ON personTable
       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'personTable')
    BEGIN
      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
      VALUES ('main', 'personTable', 'INSERT', json_object('id', cast(new.id as TEXT)), json_object('age', new.age, 'bmi', cast(new.bmi as TEXT), 'id', cast(new.id as TEXT), 'name', new.name), NULL, NULL);
    END;
    `
    )
  )

  t.assert(
    triggersSQL.includes(
      dedent`
    CREATE TRIGGER update_main_personTable_into_oplog
       AFTER UPDATE ON personTable
       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'personTable')
    BEGIN
      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
      VALUES ('main', 'personTable', 'UPDATE', json_object('id', cast(new.id as TEXT)), json_object('age', new.age, 'bmi', cast(new.bmi as TEXT), 'id', cast(new.id as TEXT), 'name', new.name), json_object('age', old.age, 'bmi', cast(old.bmi as TEXT), 'id', cast(old.id as TEXT), 'name', old.name), NULL);
    END;
    `
    )
  )

  t.assert(
    triggersSQL.includes(
      dedent`
    CREATE TRIGGER delete_main_personTable_into_oplog
       AFTER DELETE ON personTable
       WHEN 1 == (SELECT flag from _electric_trigger_settings WHERE tablename == 'personTable')
    BEGIN
      INSERT INTO _electric_oplog (namespace, tablename, optype, primaryKey, newRow, oldRow, timestamp)
      VALUES ('main', 'personTable', 'DELETE', json_object('id', cast(old.id as TEXT)), NULL, json_object('age', old.age, 'bmi', cast(old.bmi as TEXT), 'id', cast(old.id as TEXT), 'name', old.name), NULL);
    END;
    `
    )
  )
})

test('oplog insertion trigger should insert row into oplog table', (t) => {
  const { db, migrateDb } = t.context
  const tableName = personTable.tableName

  // Migrate the DB with the necessary tables and triggers
  migrateDb()

  // Insert a row in the table
  const insertRowSQL = `INSERT INTO ${tableName} (id, name, age, bmi) VALUES (1, 'John Doe', 30, 25.5)`
  db.exec(insertRowSQL)

  // Check that the oplog table contains an entry for the inserted row
  const oplogRows = db
    .prepare(`SELECT * FROM ${satelliteDefaults.oplogTable}`)
    .all()
  t.is(oplogRows.length, 1)
  t.deepEqual(oplogRows[0], {
    namespace: 'main',
    tablename: tableName,
    optype: 'INSERT',
    // `id` and `bmi` values are stored as strings
    // because we cast REAL values to text in the trigger
    // to circumvent SQLite's bug in the `json_object` function
    // that is used in the triggers.
    // cf. `joinColsForJSON` function in `src/migrators/triggers.ts`
    // These strings are then parsed back into real numbers
    // by the `deserialiseRow` function in `src/satellite/oplog.ts`
    primaryKey: JSON.stringify({ id: '1.0' }),
    newRow: JSON.stringify({
      age: 30,
      bmi: '25.5',
      id: '1.0',
      name: 'John Doe',
    }),
    oldRow: null,
    timestamp: null,
    rowid: 1,
    clearTags: '[]',
  })
})

test('oplog trigger should handle Infinity values correctly', (t) => {
  const { db, migrateDb } = t.context
  const tableName = personTable.tableName

  // Migrate the DB with the necessary tables and triggers
  migrateDb()

  // Insert a row in the table
  const insertRowSQL = `INSERT INTO ${tableName} (id, name, age, bmi) VALUES (-9e999, 'John Doe', 30, 9e999)`
  db.exec(insertRowSQL)

  // Check that the oplog table contains an entry for the inserted row
  const oplogRows = db
    .prepare(`SELECT * FROM ${satelliteDefaults.oplogTable}`)
    .all()
  t.is(oplogRows.length, 1)
  t.deepEqual(oplogRows[0], {
    namespace: 'main',
    tablename: tableName,
    optype: 'INSERT',
    // `id` and `bmi` values are stored as strings
    // because we cast REAL values to text in the trigger
    // to circumvent SQLite's bug in the `json_object` function
    // that is used in the triggers.
    // cf. `joinColsForJSON` function in `src/migrators/triggers.ts`
    // These strings are then parsed back into real numbers
    // by the `deserialiseRow` function in `src/satellite/oplog.ts`
    primaryKey: JSON.stringify({ id: '-Inf' }),
    newRow: JSON.stringify({
      age: 30,
      bmi: 'Inf',
      id: '-Inf',
      name: 'John Doe',
    }),
    oldRow: null,
    timestamp: null,
    rowid: 1,
    clearTags: '[]',
  })
})
