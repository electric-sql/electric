import test from 'ava'
import Database from 'better-sqlite3'

import { MockRegistry } from '../../../src/satellite/mock'

import { electrify } from '../../../src/drivers/better-sqlite3'
import {
  _NOT_UNIQUE_,
  _RECORD_NOT_FOUND_,
} from '../../../src/client/validation/errors/messages'
import { schema } from '../generated'

const db = new Database(':memory:')
const electric = await electrify(
  db,
  schema,
  {
    auth: {
      token: 'test-token',
    },
  },
  { registry: new MockRegistry() }
)

const tbl = electric.db.DataTypes

// Sync all shapes such that we don't get warnings on every query
await tbl.sync()

function setupDB() {
  db.exec('DROP TABLE IF EXISTS DataTypes')
  db.exec(
    "CREATE TABLE DataTypes('id' int PRIMARY KEY, 'date' varchar, 'time' varchar, 'timetz' varchar, 'timestamp' varchar, 'timestamptz' varchar, 'bool' int, 'uuid' varchar, 'int2' int2, 'int4' int4, 'float4' real, 'float8' real, 'relatedId' int);"
  )
}

test.beforeEach(setupDB)

/*
 * The tests below check that JS values are correctly converted to SQLite values
 * based on the original PG type of that value.
 * e.g. PG `timestamptz` values are represented as `Date` objects in JS
 *      and are converted to ISO-8601 strings that are stored in SQLite.
 */

test.serial('date is converted correctly to SQLite', async (t) => {
  const date = '2023-09-13'
  const d = new Date(`${date}T23:33:04.271`)
  await tbl.create({
    data: {
      id: 1,
      date: d,
    },
  })

  const rawRes = await electric.db.raw({
    sql: 'SELECT date FROM DataTypes WHERE id = ?',
    args: [1],
  })
  t.is(rawRes[0].date, date)
})

test.serial('time is converted correctly to SQLite', async (t) => {
  // Check that we store the time without taking into account timezones
  // test with 2 different time zones such that they cannot both coincide with the machine's timezone
  const date = new Date('2023-08-07 18:28:35.421')
  await tbl.create({
    data: {
      id: 1,
      time: date,
    },
  })

  const rawRes = await electric.db.raw({
    sql: 'SELECT time FROM DataTypes WHERE id = ?',
    args: [1],
  })
  t.is(rawRes[0].time, '18:28:35.421')
})

test.serial('timetz is converted correctly to SQLite', async (t) => {
  const date1 = new Date('2023-08-07 18:28:35.421+02')
  const date2 = new Date('2023-08-07 18:28:35.421+03')

  await tbl.createMany({
    data: [
      {
        id: 1,
        timetz: date1,
      },
      {
        id: 2,
        timetz: date2,
      },
    ],
  })

  const rawRes1 = await electric.db.raw({
    sql: 'SELECT timetz FROM DataTypes WHERE id = ?',
    args: [1],
  })
  t.is(rawRes1[0].timetz, '16:28:35.421') // time must have been converted to UTC time

  const rawRes2 = await electric.db.raw({
    sql: 'SELECT timetz FROM DataTypes WHERE id = ?',
    args: [2],
  })
  t.is(rawRes2[0].timetz, '15:28:35.421')
})

test.serial('timestamp is converted correctly to SQLite', async (t) => {
  const date = new Date('2023-08-07 18:28:35.421')
  await tbl.create({
    data: {
      id: 1,
      timestamp: date,
    },
  })

  const rawRes = await electric.db.raw({
    sql: 'SELECT timestamp FROM DataTypes WHERE id = ?',
    args: [1],
  })
  t.is(rawRes[0].timestamp, '2023-08-07 18:28:35.421') // time must have been converted to UTC time
})

test.serial('timestamptz is converted correctly to SQLite', async (t) => {
  const date1 = new Date('2023-08-07 18:28:35.421+02')
  const date2 = new Date('2023-08-07 18:28:35.421+03')
  await tbl.createMany({
    data: [
      {
        id: 1,
        timestamptz: date1,
      },
      {
        id: 2,
        timestamptz: date2,
      },
    ],
  })

  const rawRes1 = await electric.db.raw({
    sql: 'SELECT timestamptz FROM DataTypes WHERE id = ?',
    args: [1],
  })
  t.is(rawRes1[0].timestamptz, '2023-08-07 16:28:35.421Z') // timestamp must have been converted to UTC timestamp

  const rawRes2 = await electric.db.raw({
    sql: 'SELECT timestamptz FROM DataTypes WHERE id = ?',
    args: [2],
  })
  t.is(rawRes2[0].timestamptz, '2023-08-07 15:28:35.421Z')
})

test.serial('booleans are converted correctly to SQLite', async (t) => {
  await tbl.createMany({
    data: [
      {
        id: 1,
        bool: true,
      },
      {
        id: 2,
        bool: false,
      },
    ],
  })

  const rawRes = await electric.db.raw({
    sql: 'SELECT id, bool FROM DataTypes ORDER BY id ASC',
    args: [],
  })

  t.deepEqual(rawRes, [
    { id: 1, bool: 1 },
    { id: 2, bool: 0 },
  ])
})

test.serial('floats are converted correctly to SQLite', async (t) => {
  await tbl.createMany({
    data: [
      {
        id: 1,
        float4: 1.234,
        float8: 1.234,
      },
      {
        id: 2,
        float4: NaN,
        float8: NaN,
      },
      {
        id: 3,
        float4: Infinity,
        float8: +Infinity,
      },
      {
        id: 4,
        float4: -Infinity,
        float8: -Infinity,
      },
    ],
  })

  const rawRes = await electric.db.raw({
    sql: 'SELECT id, float4, float8 FROM DataTypes ORDER BY id ASC',
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
