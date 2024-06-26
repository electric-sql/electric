import anyTest, { TestFn } from 'ava'
import Database from 'better-sqlite3'
import { schema, JsonNull } from '../generated'
import { MockRegistry } from '../../../src/satellite/mock'
import { electrify } from '../../../src/drivers/better-sqlite3'
import { PgBasicType, sqliteConverter } from '../../../src/client/conversions'
import { PgDateType } from '../../../src/client/conversions/types'
import { QueryBuilder, sqliteBuilder } from '../../../src/migrators/builder'
import { DbSchema, ElectricClient } from '../../../src/client/model'
import { Converter } from '../../../src/client/conversions/converter'

export type ContextType = {
  electric: ElectricClient<DbSchema<any>>
  builder: QueryBuilder
  converter: Converter
}

/*
 * The tests below check that JS values are correctly converted to SQLite/PG values
 * based on the original PG type of that value.
 * e.g. PG `timestamptz` values are represented as `Date` objects in JS
 *      and are converted to ISO-8601 strings that are stored in SQLite.
 */

const test = anyTest as TestFn<ContextType>

test.beforeEach(async (t) => {
  const db = new Database(':memory:')
  const electric = await electrify(
    db,
    schema,
    {},
    { registry: new MockRegistry() }
  )

  db.exec('DROP TABLE IF EXISTS DataTypes')
  db.exec(
    "CREATE TABLE DataTypes('id' int PRIMARY KEY, 'date' varchar, 'time' varchar, 'timetz' varchar, 'timestamp' varchar, 'timestamptz' varchar, 'bool' int, 'uuid' varchar, 'int2' int2, 'int4' int4, 'int8' int8, 'float4' real, 'float8' real, 'json' varchar, 'bytea' BLOB, 'relatedId' int);"
  )
  t.context = {
    electric,
    builder: sqliteBuilder,
    converter: sqliteConverter,
  }
})

test.afterEach(async (t) => {
  const { electric } = t.context
  await electric.close()
})

test.serial(`date is converted correctly to SQLite`, async (t) => {
  const { builder, electric, converter } = t.context
  const date = '2023-09-13'
  const d = new Date(`${date}T23:33:04.271`)

  const encodedDate = converter.encode(d, PgDateType.PG_DATE)

  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, date) VALUES (1, ${builder.makePositionalParam(
      1
    )})`,
    args: [encodedDate],
  })

  const rawRes = await electric.db.rawQuery({
    sql: 'SELECT date FROM "DataTypes" WHERE id = 1',
  })
  t.is(rawRes[0].date, date)
})

test.serial(`time is converted correctly to SQLite`, async (t) => {
  const { builder, electric, converter } = t.context

  // Check that we store the time without taking into account timezones
  // test with 2 different time zones such that they cannot both coincide with the machine's timezone
  const time = new Date('2023-08-07 18:28:35.421')
  const encodedTime = converter.encode(time, PgDateType.PG_TIME)
  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, time) VALUES (1, ${builder.makePositionalParam(
      1
    )})`,
    args: [encodedTime],
  })

  const rawRes = await electric.db.rawQuery({
    sql: `SELECT time FROM "DataTypes" WHERE id = 1`,
  })
  t.is(rawRes[0].time, '18:28:35.421')
})

test.serial(`timetz is converted correctly to SQLite`, async (t) => {
  const { builder, electric, converter } = t.context

  const date1 = new Date('2023-08-07 18:28:35.421+02')
  const date2 = new Date('2023-08-07 18:28:35.421+03')

  const encodedDate1 = converter.encode(date1, PgDateType.PG_TIMETZ)
  const encodedDate2 = converter.encode(date2, PgDateType.PG_TIMETZ)

  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, timetz) VALUES (1, ${builder.makePositionalParam(
      1
    )}), (2, ${builder.makePositionalParam(2)})`,
    args: [encodedDate1, encodedDate2],
  })

  const rawRes1 = await electric.db.rawQuery({
    sql: `SELECT timetz FROM "DataTypes" WHERE id = 1`,
  })
  t.is(rawRes1[0].timetz, '16:28:35.421') // time must have been converted to UTC time

  const rawRes2 = await electric.db.rawQuery({
    sql: `SELECT timetz FROM "DataTypes" WHERE id = 2`,
  })
  t.is(rawRes2[0].timetz, '15:28:35.421')
})

test.serial(`timestamp is converted correctly to SQLite`, async (t) => {
  const { builder, electric, converter } = t.context

  const date = new Date('2023-08-07 18:28:35.421')
  const encodedDate = converter.encode(date, PgDateType.PG_TIMESTAMP)

  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, timestamp) VALUES (1, ${builder.makePositionalParam(
      1
    )})`,
    args: [encodedDate],
  })

  const rawRes = await electric.db.rawQuery({
    sql: `SELECT timestamp FROM DataTypes WHERE id = ${builder.makePositionalParam(
      1
    )}`,
    args: [1],
  })
  t.is(rawRes[0].timestamp, '2023-08-07 18:28:35.421') // time must have been converted to UTC time
})

test.serial(`timestamptz is converted correctly to SQLite`, async (t) => {
  const { builder, electric, converter } = t.context

  const date1 = new Date('2023-08-07 18:28:35.421+02')
  const date2 = new Date('2023-08-07 18:28:35.421+03')

  const encodedDate1 = converter.encode(date1, PgDateType.PG_TIMESTAMPTZ)
  const encodedDate2 = converter.encode(date2, PgDateType.PG_TIMESTAMPTZ)

  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, timestamptz) VALUES (1, ${builder.makePositionalParam(
      1
    )}), (2, ${builder.makePositionalParam(2)})`,
    args: [encodedDate1, encodedDate2],
  })

  const rawRes1 = await electric.db.rawQuery({
    sql: 'SELECT timestamptz FROM "DataTypes" WHERE id = 1',
  })
  t.is(rawRes1[0].timestamptz, '2023-08-07 16:28:35.421Z') // timestamp must have been converted to UTC timestamp

  const rawRes2 = await electric.db.rawQuery({
    sql: 'SELECT timestamptz FROM "DataTypes" WHERE id = 2',
  })
  t.is(rawRes2[0].timestamptz, '2023-08-07 15:28:35.421Z')
})

test.serial(`booleans are converted correctly to SQLite`, async (t) => {
  const { builder, electric, converter } = t.context

  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, bool) VALUES (1, ${builder.makePositionalParam(
      1
    )}), (2, ${builder.makePositionalParam(2)})`,
    args: [
      converter.encode(true, PgBasicType.PG_BOOL),
      converter.encode(false, PgBasicType.PG_BOOL),
    ],
  })

  const rawRes = await electric.db.rawQuery({
    sql: 'SELECT id, bool FROM "DataTypes" ORDER BY id ASC',
    args: [],
  })

  t.deepEqual(rawRes, [
    { id: 1, bool: 1 },
    { id: 2, bool: 0 },
  ])
})

test.serial(`floats are converted correctly to SQLite`, async (t) => {
  const { builder, electric, converter } = t.context

  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, float4, float8) VALUES (1, ${builder.makePositionalParam(
      1
    )}, ${builder.makePositionalParam(2)}), (2, ${builder.makePositionalParam(
      3
    )}, ${builder.makePositionalParam(4)}), (3, ${builder.makePositionalParam(
      5
    )}, ${builder.makePositionalParam(6)}), (4, ${builder.makePositionalParam(
      7
    )}, ${builder.makePositionalParam(8)})`,
    args: [
      converter.encode(1.234, PgBasicType.PG_FLOAT4),
      converter.encode(1.234, PgBasicType.PG_FLOAT8),
      converter.encode(NaN, PgBasicType.PG_FLOAT4),
      converter.encode(NaN, PgBasicType.PG_FLOAT8),
      converter.encode(Infinity, PgBasicType.PG_FLOAT4),
      converter.encode(+Infinity, PgBasicType.PG_FLOAT8),
      converter.encode(-Infinity, PgBasicType.PG_FLOAT4),
      converter.encode(-Infinity, PgBasicType.PG_FLOAT8),
    ],
  })

  const rawRes = await electric.db.rawQuery({
    sql: 'SELECT id, float4, float8 FROM "DataTypes" ORDER BY id ASC',
    args: [],
  })
  t.deepEqual(rawRes, [
    // 1.234 cannot be stored exactly in a float4
    // hence, there is a rounding error, which is observed when we
    // read the float4 value back into a 64-bit JS number
    // The value 1.2339999675750732 that we read back
    // is also what Math.fround(1.234) returns
    // as being the nearest 32-bit single precision
    // floating point representation of 1.234
    { id: 1, float4: 1.2339999675750732, float8: 1.234 },
    { id: 2, float4: 'NaN', float8: 'NaN' },
    { id: 3, float4: Infinity, float8: Infinity },
    { id: 4, float4: -Infinity, float8: -Infinity },
  ])
})

test.serial(`BigInts are converted correctly to SQLite`, async (t) => {
  const { builder, electric, converter } = t.context

  //db.defaultSafeIntegers(true) // enables BigInt support
  const bigInt = 9_223_372_036_854_775_807n

  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, int8) VALUES (1, ${builder.makePositionalParam(
      1
    )})`,
    args: [converter.encode(bigInt, PgBasicType.PG_INT8)],
  })

  const rawRes = await electric.db.rawQuery({
    sql: 'SELECT id, cast(int8 as TEXT) AS int8 FROM DataTypes WHERE id = ?',
    args: [1],
  })
  // because we are executing a raw query,
  // the returned BigInt for the `id`
  // is not converted into a regular number
  t.deepEqual(rawRes, [{ id: 1, int8: bigInt.toString() }])
  //db.defaultSafeIntegers(false) // disables BigInt support
})

test.serial(`json is converted correctly to SQLite`, async (t) => {
  const { builder, electric, converter } = t.context

  const json = { a: 1, b: true, c: { d: 'nested' }, e: [1, 2, 3], f: null }

  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, json) VALUES (1, ${builder.makePositionalParam(
      1
    )})`,
    args: [converter.encode(json, PgBasicType.PG_JSON)],
  })

  const rawRes = await electric.db.rawQuery({
    sql: 'SELECT json FROM DataTypes WHERE id = ?',
    args: [1],
  })
  t.is(rawRes[0].json, JSON.stringify(json))

  // Also test null values
  // this null value is not a JSON null
  // but a DB NULL that indicates absence of a value
  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, json) VALUES (2, ${builder.makePositionalParam(
      1
    )})`,
    args: [converter.encode(null, PgBasicType.PG_JSON)],
  })

  const rawRes2 = await electric.db.rawQuery({
    sql: 'SELECT json FROM DataTypes WHERE id = ?',
    args: [2],
  })
  t.is(rawRes2[0].json, null)

  // Also test JSON null value
  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, json) VALUES (3, ${builder.makePositionalParam(
      1
    )})`,
    args: [converter.encode(JsonNull, PgBasicType.PG_JSON)],
  })

  const rawRes3 = await electric.db.rawQuery({
    sql: 'SELECT json FROM DataTypes WHERE id = ?',
    args: [3],
  })
  t.is(rawRes3[0].json, JSON.stringify(null))

  // also test regular values
  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, json) VALUES (4, ${builder.makePositionalParam(
      1
    )})`,
    args: [converter.encode('foo', PgBasicType.PG_JSON)],
  })

  const rawRes4 = await electric.db.rawQuery({
    sql: 'SELECT json FROM DataTypes WHERE id = ?',
    args: [4],
  })

  t.is(rawRes4[0].json, JSON.stringify('foo'))

  // also test arrays
  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, json) VALUES (5, ${builder.makePositionalParam(
      1
    )})`,
    args: [converter.encode([1, 2, 3], PgBasicType.PG_JSON)],
  })

  const rawRes5 = await electric.db.rawQuery({
    sql: 'SELECT json FROM DataTypes WHERE id = ?',
    args: [5],
  })

  t.is(rawRes5[0].json, JSON.stringify([1, 2, 3]))
})

test.serial(`bytea is converted correctly to SQLite`, async (t) => {
  const { builder, electric, converter } = t.context

  // inserting
  const bytea1 = new Uint8Array([1, 2, 3, 4])

  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, bytea) VALUES (1, ${builder.makePositionalParam(
      1
    )})`,
    args: [converter.encode(bytea1, PgBasicType.PG_BYTEA)],
  })

  const rawRes1 = await electric.db.rawQuery({
    sql: 'SELECT bytea FROM DataTypes WHERE id = ?',
    args: [1],
  })
  t.deepEqual((rawRes1[0].bytea as Uint8Array).buffer, bytea1.buffer)

  // updating
  const bytea2 = new Uint8Array([1, 2, 3, 5])

  await electric.adapter.run({
    sql: `UPDATE "DataTypes" SET bytea = ${builder.makePositionalParam(
      1
    )} WHERE id = 1`,
    args: [converter.encode(bytea2, PgBasicType.PG_BYTEA)],
  })

  const rawRes2 = await electric.db.rawQuery({
    sql: 'SELECT bytea FROM DataTypes WHERE id = ?',
    args: [1],
  })
  t.deepEqual((rawRes2[0].bytea as Uint8Array).buffer, bytea2.buffer)

  // inserting null
  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, bytea) VALUES (2, ${builder.makePositionalParam(
      1
    )})`,
    args: [converter.encode(null, PgBasicType.PG_BYTEA)],
  })

  const rawRes3 = await electric.db.rawQuery({
    sql: 'SELECT bytea FROM DataTypes WHERE id = ?',
    args: [2],
  })
  t.is(rawRes3[0].bytea, null)

  // inserting large buffer
  const sizeInBytes = 1000000
  const bytea3 = new Uint8Array(sizeInBytes)
  bytea3.forEach((_, i) => (bytea3[i] = Math.random() * 256))

  await electric.adapter.run({
    sql: `INSERT INTO "DataTypes" (id, bytea) VALUES (3, ${builder.makePositionalParam(
      1
    )})`,
    args: [converter.encode(bytea3, PgBasicType.PG_BYTEA)],
  })

  const rawRes4 = await electric.db.rawQuery({
    sql: 'SELECT bytea FROM DataTypes WHERE id = ?',
    args: [3],
  })
  t.deepEqual((rawRes4[0].bytea as Uint8Array).buffer, bytea3.buffer)
})
