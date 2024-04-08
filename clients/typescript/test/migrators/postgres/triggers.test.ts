import { dedent } from 'ts-dedent'
import testAny, { TestFn } from 'ava'
import { generateTableTriggers } from '../../../src/migrators/triggers'
import { satelliteDefaults } from '../../../src/satellite/config'
import { migrateDb, personTable } from '../../satellite/common'
import { pgBuilder } from '../../../src/migrators/query-builder'
import { makePgDatabase } from '../../support/node-postgres'
import { Database, DatabaseAdapter } from '../../../src/drivers/node-postgres'

type Context = {
  db: Database
  migrateDb: () => Promise<void>
  stopPG: () => Promise<void>
}
const test = testAny as TestFn<Context>
const oplogTable = `"${satelliteDefaults.oplogTable.namespace}"."${satelliteDefaults.oplogTable.tablename}"`

const personNamespace = personTable.namespace
const personTableName = personTable.tableName
const qualifiedPersonTable = `"${personNamespace}"."${personTableName}"`

let i = 1
let port = 5300
test.beforeEach(async (t) => {
  const dbName = `triggers-test-${i++}`
  const { db, stop } = await makePgDatabase(dbName, port++)
  const adapter = new DatabaseAdapter(db)

  t.context = {
    db,
    migrateDb: migrateDb.bind(null, adapter, personTable, pgBuilder),
    stopPG: stop,
  }
})

test.afterEach.always(async (t) => {
  const { stopPG } = t.context as any
  await stopPG()
})

test('generateTableTriggers should create correct triggers for a table', (t) => {
  // Generate the oplog triggers
  const triggers = generateTableTriggers(personTable, pgBuilder)

  // Check that the oplog triggers are correct
  const triggersSQL = triggers.map((t) => t.sql).join('\n')
  t.assert(
    triggersSQL.includes(
      dedent`
        CREATE TRIGGER insert_main_personTable_into_oplog
          AFTER INSERT ON "main"."personTable"
            FOR EACH ROW
              EXECUTE FUNCTION insert_main_personTable_into_oplog_function();
      `
    )
  )

  t.assert(
    triggersSQL.includes(
      dedent`
      CREATE OR REPLACE FUNCTION insert_main_personTable_into_oplog_function()
      RETURNS TRIGGER AS $$
      BEGIN
        DECLARE
          flag_value INTEGER;
        BEGIN
          -- Get the flag value from _electric_trigger_settings
          SELECT flag INTO flag_value FROM main._electric_trigger_settings WHERE namespace = 'main' AND tablename = 'personTable';
  
          IF flag_value = 1 THEN
            -- Insert into _electric_oplog
            INSERT INTO main._electric_oplog (namespace, tablename, optype, "primaryKey", "newRow", "oldRow", timestamp)
            VALUES (
              'main',
              'personTable',
              'INSERT',
              json_strip_nulls(json_build_object('id', cast(new."id" as TEXT))),
              jsonb_build_object('age', new."age", 'blob', CASE WHEN new."blob" IS NOT NULL THEN encode(new."blob"::bytea, 'hex') ELSE NULL END, 'bmi', cast(new."bmi" as TEXT), 'id', cast(new."id" as TEXT), 'int8', cast(new."int8" as TEXT), 'name', new."name"),
              NULL,
              NULL
            );
          END IF;
  
          RETURN NEW;
        END;
      END;
      $$ LANGUAGE plpgsql;
      `
    )
  )

  t.assert(
    triggersSQL.includes(
      dedent`
        CREATE TRIGGER update_main_personTable_into_oplog
          AFTER UPDATE ON "main"."personTable"
            FOR EACH ROW
              EXECUTE FUNCTION update_main_personTable_into_oplog_function();
      `
    )
  )

  t.assert(
    triggersSQL.includes(
      dedent`
      CREATE OR REPLACE FUNCTION update_main_personTable_into_oplog_function()
      RETURNS TRIGGER AS $$
      BEGIN
        DECLARE
          flag_value INTEGER;
        BEGIN
          -- Get the flag value from _electric_trigger_settings
          SELECT flag INTO flag_value FROM main._electric_trigger_settings WHERE namespace = 'main' AND tablename = 'personTable';
  
          IF flag_value = 1 THEN
            -- Insert into _electric_oplog
            INSERT INTO main._electric_oplog (namespace, tablename, optype, "primaryKey", "newRow", "oldRow", timestamp)
            VALUES (
              'main',
              'personTable',
              'UPDATE',
              json_strip_nulls(json_build_object('id', cast(new."id" as TEXT))),
              jsonb_build_object('age', new."age", 'blob', CASE WHEN new."blob" IS NOT NULL THEN encode(new."blob"::bytea, 'hex') ELSE NULL END, 'bmi', cast(new."bmi" as TEXT), 'id', cast(new."id" as TEXT), 'int8', cast(new."int8" as TEXT), 'name', new."name"),
              jsonb_build_object('age', old."age", 'blob', CASE WHEN old."blob" IS NOT NULL THEN encode(old."blob"::bytea, 'hex') ELSE NULL END, 'bmi', cast(old."bmi" as TEXT), 'id', cast(old."id" as TEXT), 'int8', cast(old."int8" as TEXT), 'name', old."name"),
              NULL
            );
          END IF;
  
          RETURN NEW;
        END;
      END;
      $$ LANGUAGE plpgsql;
      `
    )
  )

  t.assert(
    triggersSQL.includes(
      dedent`
        CREATE TRIGGER delete_main_personTable_into_oplog
          AFTER DELETE ON "main"."personTable"
            FOR EACH ROW
              EXECUTE FUNCTION delete_main_personTable_into_oplog_function();
      `
    )
  )

  t.assert(
    triggersSQL.includes(
      dedent`
      CREATE OR REPLACE FUNCTION delete_main_personTable_into_oplog_function()
      RETURNS TRIGGER AS $$
      BEGIN
        DECLARE
          flag_value INTEGER;
        BEGIN
          -- Get the flag value from _electric_trigger_settings
          SELECT flag INTO flag_value FROM main._electric_trigger_settings WHERE namespace = 'main' AND tablename = 'personTable';
  
          IF flag_value = 1 THEN
            -- Insert into _electric_oplog
            INSERT INTO main._electric_oplog (namespace, tablename, optype, "primaryKey", "newRow", "oldRow", timestamp)
            VALUES (
              'main',
              'personTable',
              'DELETE',
              json_strip_nulls(json_build_object('id', cast(old."id" as TEXT))),
              NULL,
              jsonb_build_object('age', old."age", 'blob', CASE WHEN old."blob" IS NOT NULL THEN encode(old."blob"::bytea, 'hex') ELSE NULL END, 'bmi', cast(old."bmi" as TEXT), 'id', cast(old."id" as TEXT), 'int8', cast(old."int8" as TEXT), 'name', old."name"),
              NULL
            );
          END IF;
  
          RETURN NEW;
        END;
      END;
      $$ LANGUAGE plpgsql;
      `
    )
  )
})

test('oplog insertion trigger should insert row into oplog table', async (t) => {
  const { db, migrateDb } = t.context

  // Migrate the DB with the necessary tables and triggers
  await migrateDb()

  // Insert a row in the table
  const insertRowSQL = `INSERT INTO ${qualifiedPersonTable} (id, name, age, bmi, int8, blob) VALUES (1, 'John Doe', 30, 25.5, 7, '\\x0001ff')`
  await db.exec({ sql: insertRowSQL })

  // Check that the oplog table contains an entry for the inserted row
  const { rows: oplogRows } = await db.exec({
    sql: `SELECT * FROM ${oplogTable}`,
  })
  t.is(oplogRows.length, 1)
  t.deepEqual(oplogRows[0], {
    namespace: 'main',
    tablename: personTableName,
    optype: 'INSERT',
    // `id` and `bmi` values are stored as strings
    // because we cast REAL values to text in the trigger
    // to circumvent SQLite's bug in the `json_object` function
    // that is used in the triggers.
    // cf. `joinColsForJSON` function in `src/migrators/triggers.ts`
    // These strings are then parsed back into real numbers
    // by the `deserialiseRow` function in `src/satellite/oplog.ts`
    primaryKey: '{"id":"1"}',
    newRow:
      '{"id": "1", "age": 30, "bmi": "25.5", "blob": "0001ff", "int8": "7", "name": "John Doe"}', // BigInts are serialized as strings in the oplog
    oldRow: null,
    timestamp: null,
    rowid: 1,
    clearTags: '[]',
  })
})

test('oplog trigger should handle Infinity values correctly', async (t) => {
  const { db, migrateDb } = t.context
  const tableName = personTable.tableName

  // Migrate the DB with the necessary tables and triggers
  await migrateDb()

  // Insert a row in the table
  const insertRowSQL = `INSERT INTO ${qualifiedPersonTable} (id, name, age, bmi, int8) VALUES ('-Infinity', 'John Doe', 30, 'Infinity', 7)`
  await db.exec({ sql: insertRowSQL })

  // Check that the oplog table contains an entry for the inserted row
  const { rows: oplogRows } = await db.exec({
    sql: `SELECT * FROM ${oplogTable}`,
  })
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
    primaryKey: '{"id":"-Infinity"}',
    newRow:
      '{"id": "-Infinity", "age": 30, "bmi": "Infinity", "blob": null, "int8": "7", "name": "John Doe"}', // BigInts are serialized as strings in the oplog
    oldRow: null,
    timestamp: null,
    rowid: 1,
    clearTags: '[]',
  })
})

test('oplog trigger should separate null blobs from empty blobs', async (t) => {
  const { db, migrateDb } = t.context
  const namespace = personTable.namespace
  const tableName = personTable.tableName

  // Migrate the DB with the necessary tables and triggers
  await migrateDb()

  // Insert null and empty rows in the table
  const insertRowNullSQL = `INSERT INTO "${namespace}"."${tableName}" (id, name, age, bmi, int8, blob) VALUES (1, 'John Doe', 30, 25.5, 7, NULL)`
  const insertRowEmptySQL = `INSERT INTO "${namespace}"."${tableName}" (id, name, age, bmi, int8, blob) VALUES (2, 'John Doe', 30, 25.5, 7, '\\x')`
  await db.exec({ sql: insertRowNullSQL })
  await db.exec({ sql: insertRowEmptySQL })

  // Check that the oplog table contains an entry for the inserted row
  const { rows: oplogRows } = await db.exec({
    sql: `SELECT * FROM "${satelliteDefaults.oplogTable.namespace}"."${satelliteDefaults.oplogTable.tablename}"`,
  })
  t.is(oplogRows.length, 2)
  t.regex(oplogRows[0].newRow as string, /,\s*"blob":\s*null\s*,/)
  t.regex(oplogRows[1].newRow as string, /,\s*"blob":\s*""\s*,/)
})
